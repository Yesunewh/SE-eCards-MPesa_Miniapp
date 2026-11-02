/**
 * Getting codes to paid orders, in this order (the same as placeOrder() in the demo):
 *   1. our own stock (gift_codes), oldest code first
 *   2. a gift card provider (Wupex), by priority
 *   3. otherwise the line stays a pre-order ('waiting') until stock arrives
 *
 * Safety rules:
 *   - codes are claimed with FOR UPDATE SKIP LOCKED, so two orders can never get the same code
 *   - every provider purchase is recorded (provider_orders) BEFORE the call, with a unique customIdentifier
 *   - an unknown outcome (timeout) is never retried blindly: it is looked up with findOrder() first
 *   - if a provider delivers more codes than still needed, the extra codes go into stock, never lost
 */
import type { Ctx } from '../context.js';
import type { Tx } from '../db/pool.js';
import { many, maybeOne, one, withTx } from '../db/pool.js';
import type { DeliveredCard, GiftCardProvider, PlaceOrderResult } from '../adapters/giftcards/types.js';
import { ProviderUnknownError } from '../adapters/giftcards/types.js';
import { last4 } from '../lib/crypto.js';
import { isUniqueViolation } from '../lib/util.js';
import { enqueue, RetryLater } from './jobs.js';
import { queueNotification } from './notifications.js';

/** Job: deliver whatever can be delivered for one paid order. */
export async function fulfilOrder(ctx: Ctx, orderId: string): Promise<{ delivered: number }> {
  const order = await maybeOne(ctx.db, `SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (!order || !['paid', 'awaiting_stock'].includes(order.status)) return { delivered: 0 };
  const items = await many(ctx.db, `SELECT * FROM order_items WHERE order_id = $1 AND status = 'waiting' ORDER BY line_no`, [orderId]);
  const newCodeIds: string[] = [];
  for (const it of items) {
    newCodeIds.push(...await allocateFromStock(ctx, it.id));
    newCodeIds.push(...await buyFromProviders(ctx, order, it.id));
  }
  await settleOrder(ctx, orderId, newCodeIds);
  return { delivered: newCodeIds.length };
}

/** Takes available codes for one waiting line. Returns the ids of codes assigned. */
async function allocateFromStock(ctx: Ctx, itemId: string): Promise<string[]> {
  return withTx(ctx.db, async tx => {
    const it = await maybeOne(tx, `SELECT * FROM order_items WHERE id = $1 AND status = 'waiting' FOR UPDATE`, [itemId]);
    if (!it) return [];
    const need = it.quantity - it.delivered_quantity;
    if (need <= 0) return [];
    const got = await many(tx, `
      UPDATE gift_codes SET status = 'sold', order_item_id = $1, sold_at = now()
      WHERE id IN (SELECT id FROM gift_codes WHERE product_id = $2 AND status = 'available'
                   ORDER BY created_at, id LIMIT $3 FOR UPDATE SKIP LOCKED)
      RETURNING id`, [itemId, it.product_id, need]);
    if (got.length) await addDelivered(tx, itemId, got.length);
    return got.map(r => r.id);
  });
}

async function addDelivered(tx: Tx, itemId: string, n: number) {
  await tx.query(`
    UPDATE order_items SET delivered_quantity = delivered_quantity + $2,
      status = CASE WHEN delivered_quantity + $2 >= quantity THEN 'delivered' ELSE status END,
      delivered_at = CASE WHEN delivered_quantity + $2 >= quantity THEN now() ELSE delivered_at END
    WHERE id = $1`, [itemId, n]);
}

/** Tries each provider mapped to the product until the line is complete. */
async function buyFromProviders(ctx: Ctx, order: any, itemId: string): Promise<string[]> {
  const it = await one(ctx.db, `SELECT * FROM order_items WHERE id = $1`, [itemId]);
  if (it.status !== 'waiting') return [];
  // a purchase for this line is already in flight or unresolved: never start a second one
  const inflight = await maybeOne(ctx.db, `SELECT id FROM provider_orders WHERE order_item_id = $1 AND status IN ('pending','unknown','partial')`, [itemId]);
  if (inflight) return [];

  const sources = await many(ctx.db, `
    SELECT src.*, pr.adapter, pr.balance_cents, pr.priority AS provider_priority
    FROM product_sources src JOIN providers pr ON pr.id = src.provider_id
    WHERE src.product_id = $1 AND src.is_active AND pr.is_active AND pr.status = 'ok'
    ORDER BY src.priority, pr.priority`, [it.product_id]);

  for (const src of sources) {
    const need = it.quantity - it.delivered_quantity;
    if (need <= 0) break;
    const adapter = ctx.providerFor(src.adapter);
    if (!adapter) continue;
    const cost = src.unit_cost_cents * need;
    if (src.balance_cents !== null && src.balance_cents < cost) {
      await logCall(ctx, src.provider_id, { method: 'SKIP', path: '/orders', ok: false, ms: 0, ref: order.reference, note: `not enough balance for ${need} card(s)` });
      continue;
    }
    const outcome = await withProviderTurn(ctx, src.provider_id, !!adapter.serialize, () =>
      purchase(ctx, adapter, order, it, src, itemId, need));
    if (outcome === 'busy') {
      // another purchase on this provider is running or unresolved: try this order again shortly
      await enqueue(ctx.db, 'fulfil_order', { orderId: order.id }, { dedupeKey: `fulfil:${order.id}`, delaySecs: 20 });
      return [];
    }
    if (outcome.kind === 'stop') return [];
    if (outcome.kind === 'next') continue;
    const { po, result } = outcome;
    const ids = await applyProviderResult(ctx, po.id, result);
    // still delivering (provider pre-order) or not ready: wait for it, never buy the same cards elsewhere meanwhile
    if (result.status === 'processing' || (result.status === 'succeeded' && (result.remaining ?? 0) > 0)) return ids;
    const fresh = await one(ctx.db, `SELECT quantity, delivered_quantity, status FROM order_items WHERE id = $1`, [itemId]);
    it.delivered_quantity = fresh.delivered_quantity;
    if (ids.length) return ids;
  }
  return [];
}

type PurchaseOutcome = { kind: 'stop' } | { kind: 'next' } | { kind: 'done'; po: any; result: PlaceOrderResult };

/**
 * Serialized providers (Wupex) buy one order at a time, and never while an earlier purchase is unresolved:
 * that is what makes a lost answer recoverable (see adapters/giftcards/wupex.ts). Others run freely.
 */
async function withProviderTurn<T>(ctx: Ctx, providerId: string, serialize: boolean, fn: () => Promise<T>): Promise<T | 'busy'> {
  if (!serialize) return fn();
  const key = `provider:${providerId}`;
  const c = await ctx.db.connect();
  try {
    let got = false;
    for (let i = 0; i < 60 && !got; i++) {
      got = (await c.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [key])).rows[0].ok;
      if (!got) await new Promise(r => setTimeout(r, 500));
    }
    if (!got) return 'busy';
    try {
      const open = await maybeOne(ctx.db, `SELECT id FROM provider_orders WHERE provider_id = $1 AND status IN ('pending','unknown') LIMIT 1`, [providerId]);
      if (open) return 'busy';
      return await fn();
    } finally {
      await c.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
    }
  } finally {
    c.release();
  }
}

/** One purchase from one provider: record it, call it, and sort the answer. */
async function purchase(ctx: Ctx, adapter: GiftCardProvider, order: any, it: any, src: any, itemId: string, need: number): Promise<PurchaseOutcome> {
  const input = {
    externalProductId: src.external_product_id, quantity: need, unitFaceValueCents: it.face_value_cents,
    customIdentifier: ''   // set below, once the attempt number is known
  };
  adapter.onCall = c => { void logCall(ctx, src.provider_id, c); };
  let prepared: Record<string, unknown> = {};
  if (adapter.prepareOrder) {
    try {
      prepared = await adapter.prepareOrder(input);
    } catch (e) {
      await logCall(ctx, src.provider_id, { method: 'PREPARE', path: '/orders', ok: false, ms: 0, ref: order.reference, note: (e as Error).message });
      return { kind: 'next' };   // nothing was bought
    }
  }
  const attempt = (await one(ctx.db, `SELECT count(*)::int AS n FROM provider_orders WHERE order_item_id = $1`, [itemId])).n + 1;
  input.customIdentifier = `${order.reference}-${it.line_no}-${attempt}`;
  let po;
  try {
    po = await one(ctx.db, `
      INSERT INTO provider_orders (order_item_id, provider_id, external_product_id, custom_identifier, quantity, unit_cost_cents, attempts, request_context)
      VALUES ($1,$2,$3,$4,$5,$6,1,$7) RETURNING *`,
      [itemId, src.provider_id, src.external_product_id, input.customIdentifier, need, src.unit_cost_cents, prepared]);
  } catch (e) {
    if (isUniqueViolation(e)) return { kind: 'stop' };   // someone else is buying this line right now
    throw e;
  }
  let result: PlaceOrderResult;
  try {
    result = await adapter.placeOrder(input);
  } catch (e) {
    const unknown = e instanceof ProviderUnknownError;
    await ctx.db.query(`UPDATE provider_orders SET status = $2, last_error = $3 WHERE id = $1`,
      [po.id, unknown ? 'unknown' : 'failed', (e as Error).message.slice(0, 500)]);
    if (unknown) {
      await enqueue(ctx.db, 'reconcile_provider_order', { providerOrderId: po.id }, { delaySecs: 30, dedupeKey: `reconcile:${po.id}`, maxAttempts: 30 });
      return { kind: 'stop' };   // do not try another provider: this one may have charged us
    }
    return { kind: 'next' };
  }
  return { kind: 'done', po, result };
}

/** Records a provider answer: stores codes (encrypted) and assigns them to the line. */
async function applyProviderResult(ctx: Ctx, providerOrderId: string, r: PlaceOrderResult, opts: { requeue?: boolean } = {}): Promise<string[]> {
  const requeue = opts.requeue !== false;   // false when called from the lookup job, which reschedules itself
  if (r.status === 'failed') {
    await ctx.db.query(`UPDATE provider_orders SET status = 'failed', last_error = $2, response_summary = $3 WHERE id = $1`,
      [providerOrderId, r.reason, { status: 'failed', reason: r.reason, retryable: r.retryable }]);
    return [];
  }
  if (r.status === 'processing') {
    const po = await maybeOne(ctx.db, `
      UPDATE provider_orders SET status = CASE WHEN status = 'partial' OR $4 THEN 'partial' ELSE 'unknown' END,
        external_transaction_id = COALESCE($2, external_transaction_id),
        response_summary = COALESCE(response_summary, '{}'::jsonb) || $3::jsonb
      WHERE id = $1 AND status IN ('pending','unknown','partial') RETURNING id`,
      [providerOrderId, r.transactionId ?? null, { status: r.preorder ? 'provider_preorder' : 'processing' }, !!r.preorder]);
    if (po && requeue) await enqueue(ctx.db, 'reconcile_provider_order', { providerOrderId }, { delaySecs: r.retryAfterSecs ?? 20, dedupeKey: `reconcile:${providerOrderId}`, maxAttempts: 30 });
    return [];
  }
  const res = await withTx(ctx.db, async tx => {
    const po = await one(tx, `SELECT * FROM provider_orders WHERE id = $1 FOR UPDATE`, [providerOrderId]);
    if (po.status === 'succeeded' || po.status === 'failed') return { assigned: [] as string[], more: false };   // already settled
    const it = await one(tx, `SELECT * FROM order_items WHERE id = $1 FOR UPDATE`, [po.order_item_id]);
    // a provider pre-order is read again and again: store only the codes this purchase has not stored yet
    const have = new Set((await many(tx, `SELECT code_hmac FROM gift_codes WHERE provider_order_id = $1`, [po.id]))
      .map(x => Buffer.from(x.code_hmac).toString('hex')));
    const fresh = r.cards.filter(c => !have.has(Buffer.from(ctx.vault.fingerprint(c.code)).toString('hex')));
    let need = it.status === 'waiting' ? it.quantity - it.delivered_quantity : 0;
    const assigned: string[] = [];
    let stored = 0;
    for (const card of fresh) {
      const toLine = need > 0;
      const id = await insertProviderCode(ctx, tx, it.product_id, po, card, toLine ? it.id : null);
      if (id) stored++;
      if (id && toLine) { assigned.push(id); need--; }
    }
    if (assigned.length) await addDelivered(tx, it.id, assigned.length);
    const more = (r.remaining ?? 0) > 0;
    const received = have.size + stored;
    const total = r.totalCostCents ?? (po.unit_cost_cents ?? 0) * received;
    const spentNow = Math.max(0, total - Number(po.total_cost_cents ?? 0));
    await tx.query(`UPDATE provider_orders SET status = $5, external_transaction_id = $2, total_cost_cents = $3,
                    response_summary = $4, last_error = NULL WHERE id = $1`,
      [po.id, r.transactionId, total, { status: more ? 'partial' : 'succeeded', cards: received, remaining: r.remaining ?? 0, transactionId: r.transactionId },
       more ? 'partial' : 'succeeded']);
    if (spentNow) await tx.query(`UPDATE providers SET balance_cents = balance_cents - $2 WHERE id = $1 AND balance_cents IS NOT NULL`, [po.provider_id, spentNow]);
    return { assigned, more };
  });
  if (res.more && requeue) await enqueue(ctx.db, 'reconcile_provider_order', { providerOrderId }, { delaySecs: 120, dedupeKey: `reconcile:${providerOrderId}`, maxAttempts: 30 });
  return res.assigned;
}

async function insertProviderCode(ctx: Ctx, tx: Tx, productId: string, po: any, card: DeliveredCard, itemId: string | null) {
  await tx.query('SAVEPOINT code');
  try {
    const r = await tx.query(`
      INSERT INTO gift_codes (product_id, source, provider_order_id, code_enc, pin_enc, serial, key_version, code_hmac, code_last4,
                              expires_on, unit_cost_cents, status, order_item_id, sold_at)
      VALUES ($1,'provider',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [productId, po.id, ctx.vault.encrypt(card.code), card.pin ? ctx.vault.encrypt(card.pin) : null, card.serial ?? null,
       ctx.vault.keyVersion, ctx.vault.fingerprint(card.code), last4(card.code), card.expiresOn ?? null, po.unit_cost_cents,
       itemId ? 'sold' : 'available', itemId, itemId ? new Date() : null]);
    await tx.query('RELEASE SAVEPOINT code');
    return r.rows[0].id as string;
  } catch (e) {
    await tx.query('ROLLBACK TO SAVEPOINT code');
    if (isUniqueViolation(e, 'gift_codes_code_hmac_key')) {   // the provider sent a code we already hold: flag it, never deliver twice
      ctx.log('provider returned a duplicate code', { providerOrderId: po.id });
      await tx.query(`INSERT INTO audit_log (action, entity_type, entity_id, details) VALUES ('provider.duplicate_code','provider_order',$1,$2)`, [po.id, { last4: last4(card.code) }]);
      return null;
    }
    throw e;
  }
}

/** Job: settle a provider purchase whose outcome we did not get (timeout / processing). */
export async function reconcileProviderOrder(ctx: Ctx, payload: { providerOrderId: string }) {
  const po = await maybeOne(ctx.db, `SELECT po.*, pr.adapter FROM provider_orders po JOIN providers pr ON pr.id = po.provider_id WHERE po.id = $1`, [payload.providerOrderId]);
  if (!po || !['pending', 'unknown', 'partial'].includes(po.status)) return;
  const adapter: GiftCardProvider | null = ctx.providerFor(po.adapter);
  if (!adapter) throw new Error(`no adapter for ${po.adapter}`);
  adapter.onCall = c => { void logCall(ctx, po.provider_id, c); };
  await ctx.db.query(`UPDATE provider_orders SET attempts = attempts + 1 WHERE id = $1`, [po.id]);
  let r: PlaceOrderResult | null;
  try {
    const it0 = await one(ctx.db, `SELECT face_value_cents FROM order_items WHERE id = $1`, [po.order_item_id]);
    const claimed = (await many(ctx.db, `
      SELECT external_transaction_id AS t FROM provider_orders
      WHERE provider_id = $1 AND id <> $2 AND external_transaction_id IS NOT NULL AND created_at > $3::timestamptz - interval '2 days'`,
      [po.provider_id, po.id, po.created_at])).map(x => String(x.t));
    r = await adapter.findOrder(po.custom_identifier, {
      externalProductId: po.external_product_id, quantity: po.quantity, placedAt: new Date(po.created_at),
      prepared: { ...(po.request_context ?? {}), knownTransactionId: po.external_transaction_id ?? undefined, faceValueCents: it0.face_value_cents },
      claimed
    });
  } catch (e) {
    throw new RetryLater(60, `lookup failed: ${(e as Error).message}`);
  }
  const it = await one(ctx.db, `SELECT order_id FROM order_items WHERE id = $1`, [po.order_item_id]);
  if (r === null) {
    // the provider never got it: safe to buy again with a new identifier
    if (po.status === 'partial') throw new RetryLater(120, 'provider order no longer visible');   // codes were delivered: never re-buy blindly
    await ctx.db.query(`UPDATE provider_orders SET status = 'failed', last_error = 'not found at provider' WHERE id = $1`, [po.id]);
  } else if (r.status === 'processing') {
    if (r.transactionId || r.preorder) await ctx.db.query(`UPDATE provider_orders SET external_transaction_id = COALESCE(external_transaction_id, $2),
      status = CASE WHEN $3 THEN 'partial' ELSE status END WHERE id = $1`, [po.id, r.transactionId ?? null, !!r.preorder]);
    throw new RetryLater(r.retryAfterSecs ?? 30, 'provider still processing');
  } else if (r.status === 'failed') {
    await applyProviderResult(ctx, po.id, r);
  } else {
    // codes arrived (all, or the next part of a provider pre-order): hand them to the customer now
    const ids = await applyProviderResult(ctx, po.id, r, { requeue: false });
    if (ids.length) await settleOrder(ctx, it.order_id, ids);
    if ((r.remaining ?? 0) > 0) throw new RetryLater(120, `provider pre-order: ${r.remaining} code(s) still to come`);
  }
  await enqueue(ctx.db, 'fulfil_order', { orderId: it.order_id }, { dedupeKey: `fulfil:${it.order_id}` });
}

/** Sets the order status from its lines and queues customer messages. */
async function settleOrder(ctx: Ctx, orderId: string, newCodeIds: string[]) {
  await withTx(ctx.db, async tx => {
    const o = await one(tx, `SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const left = await one(tx, `SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND status = 'waiting'`, [orderId]);
    const next = left.n === 0 ? 'completed' : 'awaiting_stock';
    if (o.status !== next && ['paid', 'awaiting_stock'].includes(o.status)) {
      await tx.query(`UPDATE orders SET status = $2, completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END WHERE id = $1`, [orderId, next]);
    }
    if (newCodeIds.length) {
      await queueNotification(tx, { customerId: o.customer_id, orderId, channel: o.deliver_by, to: o.deliver_to, template: 'codes_delivered', params: { reference: o.reference, codeIds: newCodeIds, lang: o.lang } });
    }
    if (next === 'awaiting_stock' && o.status === 'paid') {
      await queueNotification(tx, { customerId: o.customer_id, orderId, channel: o.deliver_by, to: o.deliver_to, template: 'preorder_waiting', params: { reference: o.reference, lang: o.lang } });
    }
  });
}

/** After a restock: queue fulfilment for every order waiting on this product, oldest first. */
export async function fulfilWaitingForProduct(ctx: Ctx, productId: string): Promise<number> {
  const orders = await many(ctx.db, `
    SELECT o.id FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE i.product_id = $1 AND i.status = 'waiting' AND o.status IN ('paid','awaiting_stock')
    GROUP BY o.id ORDER BY min(o.paid_at), min(o.created_at)`, [productId]);
  for (const [i, o] of orders.entries()) {
    // small stagger keeps oldest-first order when several workers run
    await enqueue(ctx.db, 'fulfil_order', { orderId: o.id }, { dedupeKey: `fulfil:${o.id}`, delaySecs: i * 0.001 });
  }
  return orders.length;
}

/** Job (every few minutes): retry pre-orders that a provider might now fill. */
export async function retryWaitingJob(ctx: Ctx) {
  const orders = await many(ctx.db, `
    SELECT DISTINCT o.id, o.paid_at FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE o.status = 'awaiting_stock' AND i.status = 'waiting'
      AND (EXISTS (SELECT 1 FROM gift_codes g WHERE g.product_id = i.product_id AND g.status = 'available')
           OR EXISTS (SELECT 1 FROM product_sources s JOIN providers p ON p.id = s.provider_id
                      WHERE s.product_id = i.product_id AND s.is_active AND p.is_active AND p.status = 'ok'))
    ORDER BY o.paid_at LIMIT 200`);
  for (const o of orders) await enqueue(ctx.db, 'fulfil_order', { orderId: o.id }, { dedupeKey: `fulfil:${o.id}` });
  return orders.length;
}

async function logCall(ctx: Ctx, providerId: string, c: { method: string; path: string; status?: number; ms: number; ok: boolean; note?: string; ref?: string }) {
  await ctx.db.query(`INSERT INTO provider_api_calls (provider_id, method, path, http_status, duration_ms, ok, note, ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [providerId, c.method, c.path, c.status ?? null, c.ms, c.ok, c.note?.slice(0, 500) ?? null, c.ref ?? null]).catch(() => {});
}
