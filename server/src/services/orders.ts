import type { Ctx } from '../context.js';
import { many, maybeOne, withTx } from '../db/pool.js';
import { EMAIL_RE, addDays, badRequest, isUniqueViolation, isoDate, normMsisdn, notFound, orderRef, vatIncluded } from '../lib/util.js';
import { getSettings, productViews } from './catalog.js';
import type { Customer } from './customers.js';

export interface CartLine {
  /** Either productId, or brandId + faceValueUsd (the shape the demo cart uses: bid + amount). */
  productId?: string;
  brandId?: string;
  faceValueUsd?: number;
  quantity: number;
}

export interface CreateOrderInput {
  items: CartLine[];
  deliverBy?: 'email' | 'sms';
  deliverTo?: string;
  lang?: string;
  idempotencyKey?: string;
  channel?: 'miniapp' | 'web';
}

/**
 * Creates an unpaid order. Prices come from the database, never from the client.
 * Out-of-stock cards are allowed: they become pre-orders once paid.
 */
export async function createOrder(ctx: Ctx, customer: Customer, input: CreateOrderInput) {
  if (!Array.isArray(input.items) || input.items.length === 0) throw badRequest('cart_empty');
  if (input.items.length > 20) throw badRequest('too_many_lines');

  // where to send the codes: explicit, else the customer's saved choice
  const by = input.deliverBy ?? customer.deliver_by;
  let to = input.deliverTo?.trim() || (by === 'email' ? customer.deliver_email : customer.deliver_msisdn ?? customer.msisdn) || '';
  if (by === 'email') { if (!EMAIL_RE.test(to)) throw badRequest(to ? 'emailInvalid' : 'emailNeeded'); }
  else { const m = normMsisdn(to); if (!m) throw badRequest(to ? 'phoneInvalid' : 'phoneNeeded'); to = m; }

  if (input.idempotencyKey) {
    const existing = await maybeOne(ctx.db, `SELECT id FROM orders WHERE customer_id = $1 AND idempotency_key = $2`, [customer.id, input.idempotencyKey]);
    if (existing) return getOrder(ctx, customer.id, existing.id);
  }

  const orderId = await withTx(ctx.db, async tx => {
    const s = await getSettings(tx);
    const products = await productViews(tx, s, 'p.is_active AND b.is_active AND NOT b.is_hidden');
    const byId = new Map(products.map(p => [p.id, p]));
    const byKey = new Map(products.map(p => [`${p.brandId}:${p.faceValueUsd}`, p]));

    // merge duplicate lines (same product)
    const lines = new Map<string, { p: (typeof products)[number]; qty: number }>();
    for (const l of input.items) {
      const p = l.productId ? byId.get(l.productId) : byKey.get(`${l.brandId}:${l.faceValueUsd}`);
      if (!p) throw badRequest('product_unavailable', 'A card in the cart is no longer sold', { line: l });
      if (!Number.isInteger(l.quantity) || l.quantity < 1) throw badRequest('bad_quantity');
      const cur = lines.get(p.id);
      lines.set(p.id, { p, qty: (cur?.qty ?? 0) + l.quantity });
    }
    for (const { p, qty } of lines.values()) {
      if (qty > s.max_qty_per_line) throw badRequest('qty_over_limit', `At most ${s.max_qty_per_line} of one card per order`, { productId: p.id });
    }
    const total = [...lines.values()].reduce((sum, l) => sum + l.p.priceMinor * l.qty, 0);
    if (total > s.max_order_total_minor) throw badRequest('order_too_large');
    const vat = vatIncluded(total, s.vat_rate);

    let id: string | null = null;
    for (let attempt = 0; attempt < 5 && !id; attempt++) {
      try {
        await tx.query('SAVEPOINT ref');
        const r = await tx.query(`
          INSERT INTO orders (reference, customer_id, subtotal_minor, vat_minor, total_minor, usd_etb_rate, vat_rate,
                              deliver_by, deliver_to, lang, channel, idempotency_key, expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + make_interval(secs => $13)) RETURNING id`,
          [orderRef(), customer.id, total - vat, vat, total, s.usd_etb_rate, s.vat_rate, by, to,
           input.lang ?? customer.lang, input.channel ?? 'miniapp', input.idempotencyKey ?? null, s.payment_timeout_secs]);
        id = r.rows[0].id;
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT ref');
        if (!isUniqueViolation(e, 'orders_reference_key')) throw e;   // reference collision: draw another
      }
    }
    if (!id) throw new Error('could not allocate an order reference');

    let lineNo = 0;
    for (const { p, qty } of lines.values()) {
      await tx.query(`
        INSERT INTO order_items (order_id, line_no, product_id, brand_id, title, face_value_cents, quantity,
                                 unit_price_minor, line_total_minor, eta)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, ++lineNo, p.id, p.brandId, p.title, Math.round(p.faceValueUsd * 100), qty, p.priceMinor, p.priceMinor * qty,
         p.restockEta ?? isoDate(addDays(new Date(), s.default_restock_days))]);
    }
    return id;
  }).catch(async e => {
    // two identical requests at once: the loser returns the winner's order
    if (input.idempotencyKey && isUniqueViolation(e, 'orders_customer_id_idempotency_key_key')) {
      const ex = await maybeOne(ctx.db, `SELECT id FROM orders WHERE customer_id = $1 AND idempotency_key = $2`, [customer.id, input.idempotencyKey]);
      if (ex) return ex.id as string;
    }
    throw e;
  });
  return getOrder(ctx, customer.id, orderId);
}

/** One order as the customer sees it, with decrypted codes for delivered cards. */
export async function getOrder(ctx: Ctx, customerId: string | null, idOrRef: string, opts: { withCodes?: boolean } = { withCodes: true }) {
  const isRef = /^EC\d{8}$/.test(idOrRef);
  if (!isRef && !/^[0-9a-f-]{36}$/i.test(idOrRef)) throw notFound('order_not_found');
  const o = await maybeOne(ctx.db,
    `SELECT * FROM orders WHERE ${isRef ? 'reference' : 'id'} = $1 ${customerId ? 'AND customer_id = $2' : ''}`,
    customerId ? [idOrRef, customerId] : [idOrRef]);
  if (!o) throw notFound('order_not_found');
  const items = await many(ctx.db, `SELECT * FROM order_items WHERE order_id = $1 ORDER BY line_no`, [o.id]);
  const codes = opts.withCodes === false ? [] : await many(ctx.db,
    `SELECT id, order_item_id, code_enc, pin_enc, serial, expires_on, customer_used_at
     FROM gift_codes WHERE order_item_id = ANY($1) ORDER BY sold_at, id`, [items.map(i => i.id)]);
  const payment = await maybeOne(ctx.db,
    `SELECT id, status, receipt_number, result_desc, created_at FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [o.id]);
  return {
    id: o.id, reference: o.reference, status: o.status, createdAt: o.created_at, paidAt: o.paid_at, completedAt: o.completed_at,
    expiresAt: o.expires_at, currency: o.currency,
    subtotalMinor: o.subtotal_minor, vatMinor: o.vat_minor, totalMinor: o.total_minor, vatRate: o.vat_rate,
    delivery: { by: o.deliver_by, to: o.deliver_to },
    payment: payment ? { id: payment.id, status: payment.status, receipt: payment.receipt_number, message: payment.result_desc } : null,
    items: items.map(it => ({
      id: it.id, lineNo: it.line_no, productId: it.product_id, brandId: it.brand_id, title: it.title,
      faceValueUsd: it.face_value_cents / 100, quantity: it.quantity, deliveredQuantity: it.delivered_quantity,
      unitPriceMinor: it.unit_price_minor, lineTotalMinor: it.line_total_minor, status: it.status,
      eta: it.status === 'waiting' ? it.eta : null, deliveredAt: it.delivered_at,
      codes: codes.filter(c => c.order_item_id === it.id).map(c => ({
        id: c.id, code: ctx.vault.decrypt(c.code_enc), pin: c.pin_enc ? ctx.vault.decrypt(c.pin_enc) : null,
        serial: c.serial, expiresOn: c.expires_on, usedAt: c.customer_used_at
      }))
    }))
  };
}

/** Paid orders with lines and codes, newest first (the app's My Orders and wallet in one call). */
export async function listOrdersFull(ctx: Ctx, customerId: string, limit = 50) {
  const ids = await many(ctx.db, `SELECT id FROM orders WHERE customer_id = $1 AND status IN ('paid','awaiting_stock','completed')
                                  ORDER BY created_at DESC LIMIT $2`, [customerId, Math.min(limit, 100)]);
  const out = [];
  for (const r of ids) out.push(await getOrder(ctx, customerId, r.id));
  return out;
}

export async function listOrders(ctx: Ctx, customerId: string, limit = 50) {
  const rows = await many(ctx.db, `
    SELECT o.id, o.reference, o.status, o.total_minor, o.created_at, o.paid_at,
           COALESCE(json_agg(json_build_object('brandId', i.brand_id, 'title', i.title, 'quantity', i.quantity,
                     'deliveredQuantity', i.delivered_quantity, 'status', i.status, 'eta', i.eta) ORDER BY i.line_no), '[]') AS items
    FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE o.customer_id = $1 AND o.status NOT IN ('cancelled')
    GROUP BY o.id ORDER BY o.created_at DESC LIMIT $2`, [customerId, Math.min(limit, 200)]);
  return rows.map(r => ({ id: r.id, reference: r.reference, status: r.status, totalMinor: r.total_minor, createdAt: r.created_at, paidAt: r.paid_at, items: r.items }));
}

/** Customer cancels an order they have not paid for. */
export async function cancelOrder(ctx: Ctx, customerId: string, orderId: string) {
  await withTx(ctx.db, async tx => {
    const o = await maybeOne(tx, `SELECT id, status FROM orders WHERE id = $1 AND customer_id = $2 FOR UPDATE`, [orderId, customerId]);
    if (!o) throw notFound('order_not_found');
    if (o.status !== 'pending_payment') throw badRequest('order_not_cancellable');
    const open = await maybeOne(tx, `SELECT 1 FROM payments WHERE order_id = $1 AND status IN ('initiated','pending')`, [orderId]);
    if (open) throw badRequest('payment_in_progress');
    await tx.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
    await tx.query(`UPDATE order_items SET status = 'cancelled' WHERE order_id = $1`, [orderId]);
  });
}

/** "I used this code" toggle (K_USED in the demo). */
export async function markCodeUsed(ctx: Ctx, customerId: string, codeId: string, used: boolean) {
  const r = await ctx.db.query(`
    UPDATE gift_codes g SET customer_used_at = CASE WHEN $3 THEN COALESCE(g.customer_used_at, now()) ELSE NULL END
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE g.id = $1 AND g.order_item_id = i.id AND o.customer_id = $2`, [codeId, customerId, used]);
  if (!r.rowCount) throw notFound('code_not_found');
}
