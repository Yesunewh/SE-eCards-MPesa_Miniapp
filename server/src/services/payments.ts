import type { Ctx } from '../context.js';
import { many, maybeOne, one, withTx } from '../db/pool.js';
import type { PaymentOutcome } from '../adapters/payments/types.js';
import { AppError, badRequest, notFound } from '../lib/util.js';
import { enqueue, RetryLater } from './jobs.js';

const OPEN = ['initiated', 'pending'];
/** How long we keep asking M-Pesa about a payment before calling it timed out. */
const GIVE_UP_AFTER_SECS = 30 * 60;

export const callbackUrl = (ctx: Ctx) =>
  `${ctx.cfg.PUBLIC_BASE_URL.replace(/\/$/, '')}/v1/webhooks/${ctx.payments.name === 'miniapp' ? 'mpesa-miniapp' : 'mpesa'}/${ctx.cfg.MPESA_CALLBACK_SECRET || 'dev'}`;
const methodOf = (ctx: Ctx) => ctx.payments.name === 'mock' ? 'mock' : ctx.payments.name === 'miniapp' ? 'mpesa_miniapp' : 'mpesa';

/** Customer taps "Pay": send the M-Pesa payment request for an unpaid order. */
export async function startPayment(ctx: Ctx, customerId: string, orderId: string) {
  const prep = await withTx(ctx.db, async tx => {
    const o = await maybeOne(tx, `SELECT o.*, c.msisdn FROM orders o JOIN customers c ON c.id = o.customer_id
                                  WHERE o.id = $1 AND o.customer_id = $2 FOR UPDATE OF o`, [orderId, customerId]);
    if (!o) throw notFound('order_not_found');
    if (o.status !== 'pending_payment') throw badRequest('order_not_payable', `Order is ${o.status}`);
    if (new Date(o.expires_at) <= new Date()) throw badRequest('order_expired');
    const open = await maybeOne(tx, `SELECT * FROM payments WHERE order_id = $1 AND status = ANY($2)`, [orderId, OPEN]);
    if (open) return { existing: open };   // already asked: same request, the customer just needs to approve it
    const attempt = (await one(tx, `SELECT count(*)::int AS n FROM payments WHERE order_id = $1`, [orderId])).n + 1;
    const p = await one(tx, `INSERT INTO payments (order_id, method, amount_minor, msisdn) VALUES ($1,$2,$3,$4) RETURNING *`,
      [orderId, methodOf(ctx), o.total_minor, o.msisdn]);
    return { payment: p, order: o, attempt };
  });
  if ('existing' in prep) return paymentView(prep.existing);

  const { payment, order, attempt } = prep;
  try {
    const r = await ctx.payments.initiate({
      paymentId: payment.id, attempt, amountMinor: order.total_minor, msisdn: order.msisdn, reference: order.reference,
      orderCreatedAt: new Date(order.created_at), description: `eCards ${order.reference}`, callbackUrl: callbackUrl(ctx)
    });
    const p = await one(ctx.db, `
      UPDATE payments SET status = 'pending', checkout_request_id = $2, merchant_request_id = $3, request_payload = $4
      WHERE id = $1 RETURNING *`, [payment.id, r.checkoutRequestId, r.merchantRequestId ?? null,
        { raw: r.raw ?? null, clientAction: r.clientAction ?? null }]);
    if (r.immediate) {
      await applyPaymentOutcome(ctx, r.immediate, { source: 'pay reply' });
      return paymentView(await one(ctx.db, `SELECT * FROM payments WHERE id = $1`, [p.id]));
    }
    // in case the callback never arrives
    await enqueue(ctx.db, 'check_payment', { paymentId: p.id }, { delaySecs: 60, dedupeKey: `check_payment:${p.id}`, maxAttempts: 40 });
    return paymentView(p);
  } catch (e) {
    await ctx.db.query(`UPDATE payments SET status = 'failed', result_desc = $2, completed_at = now() WHERE id = $1`,
      [payment.id, `initiate failed: ${(e as Error).message}`.slice(0, 500)]);
    throw new AppError(502, 'payment_unavailable', 'M-Pesa could not start the payment. Please try again.');
  }
}

const paymentView = (p: any) => ({
  id: p.id, status: p.status, amountMinor: p.amount_minor, checkoutRequestId: p.checkout_request_id,
  clientAction: p.request_payload?.clientAction ?? null   // e.g. { type: 'tradePay', paymentUrl } for the M-Pesa cashier
});

/** M-Pesa callback. Always stored first; processing is idempotent (M-Pesa may send the same result twice). */
export async function handleMpesaCallback(ctx: Ctx, body: unknown, headers: Record<string, unknown> = {}) {
  const outcome = ctx.payments.parseCallback(body);
  const ev = await one(ctx.db,
    `INSERT INTO webhook_events (source, external_id, payload, headers, verified) VALUES ('mpesa', $1, $2, $3, true) RETURNING id`,
    [outcome?.checkoutRequestId ?? null, JSON.stringify(body ?? null), headers]);
  if (!outcome) {
    await ctx.db.query(`UPDATE webhook_events SET error = 'unrecognised payload', processed_at = now() WHERE id = $1`, [ev.id]);
    return { ok: false };
  }
  try {
    const r = await applyPaymentOutcome(ctx, outcome, body);
    await ctx.db.query(`UPDATE webhook_events SET processed_at = now(), error = $2 WHERE id = $1`, [ev.id, r === 'unknown_payment' ? r : null]);
    return { ok: true, result: r };
  } catch (e) {
    await ctx.db.query(`UPDATE webhook_events SET error = $2 WHERE id = $1`, [ev.id, (e as Error).message.slice(0, 1000)]);
    throw e;
  }
}

export type ApplyResult = 'paid' | 'already_final' | 'declined' | 'unknown_payment' | 'amount_mismatch' | 'duplicate_payment';

/** The single place a payment result changes payments and orders. */
export async function applyPaymentOutcome(ctx: Ctx, o: PaymentOutcome, raw?: unknown): Promise<ApplyResult> {
  return withTx(ctx.db, async tx => {
    const p = await maybeOne(tx, `SELECT * FROM payments WHERE checkout_request_id = $1 FOR UPDATE`, [o.checkoutRequestId]);
    if (!p) { ctx.log('payment result for unknown request', { checkoutRequestId: o.checkoutRequestId }); return 'unknown_payment'; }
    if (p.status === 'succeeded') return 'already_final';

    if (o.status !== 'succeeded') {
      if (!OPEN.includes(p.status)) return 'already_final';
      await tx.query(`UPDATE payments SET status = $2, result_code = $3, result_desc = $4, callback_payload = $5, completed_at = now() WHERE id = $1`,
        [p.id, o.status, o.resultCode, o.resultDesc, raw === undefined ? null : JSON.stringify(raw)]);
      return 'declined';   // the order stays pending_payment so the customer can try again
    }

    // Money moved. A success always wins, even after we gave up (timeout) or the order expired.
    if (o.amountMinor !== undefined && o.amountMinor !== p.amount_minor) {
      await tx.query(`UPDATE payments SET status = 'failed', result_code = $2, result_desc = $3, receipt_number = $4, callback_payload = $5, completed_at = now() WHERE id = $1`,
        [p.id, o.resultCode, `AMOUNT MISMATCH: paid ${o.amountMinor}, expected ${p.amount_minor}. Needs manual review.`, o.receiptNumber ?? null, raw === undefined ? null : JSON.stringify(raw)]);
      await audit(tx, 'payment.amount_mismatch', p.id, { paid: o.amountMinor, expected: p.amount_minor, receipt: o.receiptNumber });
      return 'amount_mismatch';
    }
    const other = await maybeOne(tx, `SELECT id FROM payments WHERE order_id = $1 AND status = 'succeeded' AND id <> $2`, [p.order_id, p.id]);
    if (other) {
      await tx.query(`UPDATE payments SET status = 'failed', result_code = $2, result_desc = 'DUPLICATE PAYMENT: order already paid. Refund needed.', receipt_number = $3, callback_payload = $4, completed_at = now() WHERE id = $1`,
        [p.id, o.resultCode, o.receiptNumber ?? null, raw === undefined ? null : JSON.stringify(raw)]);
      await audit(tx, 'payment.duplicate', p.id, { orderId: p.order_id, receipt: o.receiptNumber });
      return 'duplicate_payment';
    }

    await tx.query(`UPDATE payments SET status = 'succeeded', result_code = $2, result_desc = $3, receipt_number = $4, callback_payload = COALESCE($5, callback_payload), completed_at = now() WHERE id = $1`,
      [p.id, o.resultCode, o.resultDesc, o.receiptNumber ?? null, raw === undefined ? null : JSON.stringify(raw)]);
    // close any other open attempt for the same order
    await tx.query(`UPDATE payments SET status = 'cancelled', result_desc = 'superseded', completed_at = now() WHERE order_id = $1 AND id <> $2 AND status = ANY($3)`, [p.order_id, p.id, OPEN]);
    await tx.query(`UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1 AND status IN ('pending_payment','expired','payment_failed','cancelled')`, [p.order_id]);
    await tx.query(`UPDATE order_items SET status = 'waiting' WHERE order_id = $1 AND status IN ('pending','cancelled')`, [p.order_id]);
    await enqueue(tx, 'fulfil_order', { orderId: p.order_id }, { dedupeKey: `fulfil:${p.order_id}` });
    return 'paid';
  });
}

async function audit(tx: any, action: string, paymentId: string, details: object) {
  await tx.query(`INSERT INTO audit_log (action, entity_type, entity_id, details) VALUES ($1, 'payment', $2, $3)`, [action, paymentId, details]);
}

/** Job: the callback is late, ask M-Pesa directly. */
export async function checkPaymentJob(ctx: Ctx, payload: { paymentId: string }) {
  const p = await maybeOne(ctx.db, `SELECT * FROM payments WHERE id = $1`, [payload.paymentId]);
  if (!p || !OPEN.includes(p.status) || !p.checkout_request_id) return;
  const outcome = await ctx.payments.query(p.checkout_request_id);
  if (outcome) { await applyPaymentOutcome(ctx, outcome, { source: 'query', outcome }); return; }
  const ageSecs = (Date.now() - new Date(p.created_at).getTime()) / 1000;
  if (ageSecs < GIVE_UP_AFTER_SECS) throw new RetryLater(ageSecs < 300 ? 30 : 120, 'still pending');
  await ctx.db.query(`UPDATE payments SET status = 'timeout', result_desc = 'no answer from M-Pesa', completed_at = now() WHERE id = $1 AND status = ANY($2)`, [p.id, OPEN]);
}

/** Job (every minute): unpaid orders past their deadline expire. A late payment still revives them. */
export async function expireOrdersJob(ctx: Ctx) {
  const r = await ctx.db.query(`
    UPDATE orders o SET status = 'expired'
    WHERE o.status = 'pending_payment' AND o.expires_at < now()
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status IN ('initiated','pending'))`);
  return r.rowCount ?? 0;
}

/**
 * M-Pesa Ethiopia C2B Validation: M-Pesa asks before taking the money. We accept only a bill reference
 * that is an open payment of ours, for exactly its amount. (Result codes from the M-Pesa docs.)
 */
export async function handleC2bValidation(ctx: Ctx, body: any) {
  const ev = await one(ctx.db, `INSERT INTO webhook_events (source, external_id, payload, verified) VALUES ('mpesa_c2b', $1, $2, true) RETURNING id`,
    [String(body?.TransID ?? '') || null, JSON.stringify(body ?? null)]);
  const ref = String(body?.BillRefNumber ?? '').trim();
  const p = ref ? await maybeOne(ctx.db, `SELECT * FROM payments WHERE checkout_request_id = $1`, [ref]) : null;
  let reply: { ResultCode: number | string; ResultDesc: string };
  if (!p || p.status === 'succeeded') reply = { ResultCode: 'C2B00012', ResultDesc: 'Invalid Account Number' };
  else if (Math.round(Number(body?.TransAmount) * 100) !== Number(p.amount_minor)) reply = { ResultCode: 'C2B00013', ResultDesc: 'Invalid Amount' };
  else reply = { ResultCode: 0, ResultDesc: 'Request processed successfully' };
  await ctx.db.query(`UPDATE webhook_events SET processed_at = now(), error = $2 WHERE id = $1`, [ev.id, reply.ResultCode === 0 ? null : `validation ${reply.ResultCode}`]);
  return reply;
}

/**
 * What the app saw after payWithMpesa. Informational: a cancel or failure closes the attempt (so the customer
 * can try again), but only M-Pesa's confirmation marks an order paid, even if it arrives after a "cancel".
 */
export async function reportClientResult(ctx: Ctx, customerId: string, orderId: string,
  r: { paymentId: string; status: 'success' | 'cancelled' | 'failed'; transactionId?: string; error?: number | string; errorMessage?: string }) {
  const p = await maybeOne(ctx.db, `SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = $1 AND o.id = $2 AND o.customer_id = $3`,
    [r.paymentId, orderId, customerId]);
  if (!p) throw notFound('payment_not_found');
  await ctx.db.query(`UPDATE payments SET client_result = $2 WHERE id = $1`, [p.id, { ...r, at: new Date().toISOString() }]);
  if (r.status !== 'success' && OPEN.includes(p.status)) {
    await ctx.db.query(`UPDATE payments SET status = $2, result_code = $3, result_desc = $4, completed_at = now() WHERE id = $1 AND status = ANY($5)`,
      [p.id, r.status === 'cancelled' ? 'cancelled' : 'failed', String(r.error ?? ''), (r.errorMessage ?? r.status).slice(0, 300), OPEN]);
  }
  return { ok: true };
}

/** Admin: payments needing a human (mismatches, duplicates, unknown callbacks). */
export async function paymentsNeedingReview(ctx: Ctx) {
  return many(ctx.db, `
    SELECT p.id, p.order_id, o.reference, p.status, p.amount_minor, p.receipt_number, p.result_desc, p.updated_at
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.status = 'failed' AND (p.result_desc LIKE 'AMOUNT MISMATCH%' OR p.result_desc LIKE 'DUPLICATE PAYMENT%')
    ORDER BY p.updated_at DESC`);
}

/** Admin: C2B confirmations that matched no payment of ours (money received, needs a human). */
export async function unmatchedPayments(ctx: Ctx) {
  return many(ctx.db, `
    SELECT id, external_id AS trans_id, payload->>'BillRefNumber' AS bill_ref, payload->>'TransAmount' AS amount,
           payload->>'MSISDN' AS msisdn, received_at
    FROM webhook_events WHERE error = 'unknown_payment' ORDER BY received_at DESC LIMIT 200`);
}
