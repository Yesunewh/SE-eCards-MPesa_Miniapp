import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeCtx, reset, newCustomer, addStock, payFor, drainJobs } from './helpers.js';
import { createOrder, getOrder } from '../src/services/orders.js';
import { applyPaymentOutcome, expireOrdersJob, handleMpesaCallback, startPayment, checkPaymentJob } from '../src/services/payments.js';
import { mockCallback } from '../src/adapters/payments/mock.js';
import { many, one } from '../src/db/pool.js';

const ctx = makeCtx();
afterAll(() => ctx.db.end());
beforeEach(async () => { await reset(ctx); await addStock(ctx, 'netflix', 50, 10); });

const order = async (c: any, qty = 1) => createOrder(ctx, c, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: qty }] });

describe('M-Pesa payments', () => {
  it('approved payment → order paid → codes delivered → SMS sent', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer, 2);
    const { payment, result } = await payFor(ctx, customer, o.id);
    expect(payment.status).toBe('pending');
    expect(ctx.payments.initiated.get(payment.checkoutRequestId!)).toMatchObject({ amountMinor: 2_650_000, msisdn: customer.msisdn, reference: o.reference });
    expect(result).toMatchObject({ ok: true, result: 'paid' });
    await drainJobs(ctx);
    const done = await getOrder(ctx, customer.id, o.id);
    expect(done.status).toBe('completed');
    expect(done.payment!.receipt).toMatch(/^MCK/);
    expect(done.items[0]!.codes).toHaveLength(2);
    expect(ctx.notes.sent).toHaveLength(1);
    expect(ctx.notes.sent[0]!.to).toBe(customer.msisdn);
    expect(ctx.notes.sent[0]!.text).toContain(done.items[0]!.codes[0]!.code);
  });

  it('the same callback twice changes nothing the second time', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer);
    const { callback } = await payFor(ctx, customer, o.id);
    expect(await handleMpesaCallback(ctx, callback)).toMatchObject({ result: 'already_final' });
    await drainJobs(ctx);
    expect((await getOrder(ctx, customer.id, o.id)).items[0]!.codes).toHaveLength(1);
    expect((await one(ctx.db, `SELECT count(*)::int n FROM webhook_events`)).n).toBe(2);   // both stored for audit
  });

  it('tapping Pay twice sends one M-Pesa request', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer);
    const a = await startPayment(ctx, customer.id, o.id);
    const b = await startPayment(ctx, customer.id, o.id);
    expect(b.id).toBe(a.id);
    expect(ctx.payments.initiated.size).toBe(1);
  });

  it('declined or cancelled: order stays payable, the customer can try again', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer);
    const first = await payFor(ctx, customer, o.id, false);
    expect(first.result).toMatchObject({ result: 'declined' });
    expect((await getOrder(ctx, customer.id, o.id)).status).toBe('pending_payment');
    const second = await payFor(ctx, customer, o.id, true);
    expect(second.payment.id).not.toBe(first.payment.id);
    await drainJobs(ctx);
    expect((await getOrder(ctx, customer.id, o.id)).status).toBe('completed');
  });

  it('M-Pesa refusing the request gives a clear error and leaves no open payment', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer);
    ctx.payments.failNextInitiate = true;
    await expect(startPayment(ctx, customer.id, o.id)).rejects.toMatchObject({ code: 'payment_unavailable', status: 502 });
    const again = await startPayment(ctx, customer.id, o.id);
    expect(again.status).toBe('pending');
  });

  it('a wrong amount is not accepted as payment and is flagged for review', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer);
    const p = await startPayment(ctx, customer.id, o.id);
    const r = await handleMpesaCallback(ctx, mockCallback(p.checkoutRequestId!, { amountMinor: 100 }));
    expect(r).toMatchObject({ result: 'amount_mismatch' });
    expect((await getOrder(ctx, customer.id, o.id)).status).toBe('pending_payment');
    expect((await many(ctx.db, `SELECT action FROM audit_log`)).map(x => x.action)).toContain('payment.amount_mismatch');
  });

  it('a late success revives an expired order (the money moved, so we deliver)', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer);
    const p = await startPayment(ctx, customer.id, o.id);
    await ctx.db.query(`UPDATE payments SET status = 'timeout' WHERE id = $1`, [p.id]);
    await ctx.db.query(`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1`, [o.id]);
    expect(await expireOrdersJob(ctx)).toBe(1);
    expect((await getOrder(ctx, customer.id, o.id)).status).toBe('expired');
    await handleMpesaCallback(ctx, mockCallback(p.checkoutRequestId!, { amountMinor: p.amountMinor }));
    await drainJobs(ctx);
    expect((await getOrder(ctx, customer.id, o.id)).status).toBe('completed');
  });

  it('expiry waits while a payment is still open', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer);
    await startPayment(ctx, customer.id, o.id);
    await ctx.db.query(`UPDATE orders SET expires_at = now() - interval '1 minute'`);
    expect(await expireOrdersJob(ctx)).toBe(0);
  });

  it('two successful payments for one order: the second is flagged as a duplicate for refund', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer);
    const p1 = await startPayment(ctx, customer.id, o.id);
    await ctx.db.query(`UPDATE payments SET status = 'timeout' WHERE id = $1`, [p1.id]);   // we gave up on the first …
    const p2 = await startPayment(ctx, customer.id, o.id);
    await handleMpesaCallback(ctx, mockCallback(p2.checkoutRequestId!, { amountMinor: p2.amountMinor }));
    const r = await handleMpesaCallback(ctx, mockCallback(p1.checkoutRequestId!, { amountMinor: p1.amountMinor }));   // … but it went through too
    expect(r).toMatchObject({ result: 'duplicate_payment' });
    const p = await one(ctx.db, `SELECT status, result_desc FROM payments WHERE id = $1`, [p1.id]);
    expect(p.result_desc).toMatch(/^DUPLICATE PAYMENT/);
  });

  it('missing callback: the check job asks M-Pesa and settles the payment', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer);
    const p = await startPayment(ctx, customer.id, o.id);
    ctx.payments.settled.set(p.checkoutRequestId!, { checkoutRequestId: p.checkoutRequestId!, status: 'succeeded', resultCode: '0', resultDesc: 'ok', receiptNumber: 'QRY1' });
    await checkPaymentJob(ctx, { paymentId: p.id });
    await drainJobs(ctx);
    const done = await getOrder(ctx, customer.id, o.id);
    expect(done.status).toBe('completed');
    expect(done.payment!.receipt).toBe('QRY1');
  });

  it('no answer for 30 minutes: payment marked timed out', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await order(customer);
    const p = await startPayment(ctx, customer.id, o.id);
    await expect(checkPaymentJob(ctx, { paymentId: p.id })).rejects.toThrow('still pending');
    await ctx.db.query(`UPDATE payments SET created_at = now() - interval '31 minutes' WHERE id = $1`, [p.id]);
    await checkPaymentJob(ctx, { paymentId: p.id });
    expect((await one(ctx.db, `SELECT status FROM payments WHERE id = $1`, [p.id])).status).toBe('timeout');
  });

  it('ignores results for payments it does not know, and junk bodies', async () => {
    expect(await applyPaymentOutcome(ctx, { checkoutRequestId: 'nope', status: 'succeeded', resultCode: '0', resultDesc: '' })).toBe('unknown_payment');
    expect(await handleMpesaCallback(ctx, { random: true })).toEqual({ ok: false });
  });

  it('cannot pay for someone else’s order, or an expired one', async () => {
    const a = await newCustomer(ctx), b = await newCustomer(ctx);
    const o = await order(a.customer);
    await expect(startPayment(ctx, b.customer.id, o.id)).rejects.toMatchObject({ code: 'order_not_found' });
    await ctx.db.query(`UPDATE orders SET expires_at = now() - interval '1 second'`);
    await expect(startPayment(ctx, a.customer.id, o.id)).rejects.toMatchObject({ code: 'order_expired' });
  });
});
