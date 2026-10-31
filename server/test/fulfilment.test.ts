import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeCtx, reset, newCustomer, addStock, buy, drainJobs, payFor, productId } from './helpers.js';
import { createOrder, getOrder } from '../src/services/orders.js';
import { uploadCodes } from '../src/services/stock.js';
import { many, one } from '../src/db/pool.js';

const ctx = makeCtx();
afterAll(() => ctx.db.end());

describe('fulfilment from own stock', () => {
  beforeEach(() => reset(ctx));

  it('uses the oldest codes first and marks them sold', async () => {
    const { customer } = await newCustomer(ctx);
    const pid = await productId(ctx, 'steam', 50);
    await uploadCodes(ctx, null, pid, [{ code: 'OLD-0001-AAAA' }]);
    await uploadCodes(ctx, null, pid, [{ code: 'NEW-0002-BBBB' }]);
    const id = await buy(ctx, customer, [{ brandId: 'steam', faceValueUsd: 50, quantity: 1 }]);
    const o = await getOrder(ctx, customer.id, id);
    expect(o.items[0]!.codes.map(c => c.code)).toEqual(['OLD-0001-AAAA']);
    expect((await one(ctx.db, `SELECT count(*)::int n FROM gift_codes WHERE status = 'available'`)).n).toBe(1);
  });

  it('no stock and no provider: paid order becomes a pre-order, filled when stock is uploaded', async () => {
    const { customer } = await newCustomer(ctx);
    const id = await buy(ctx, customer, [{ brandId: 'cod', faceValueUsd: 100, quantity: 3 }]);
    let o = await getOrder(ctx, customer.id, id);
    expect(o.status).toBe('awaiting_stock');
    expect(o.items[0]).toMatchObject({ status: 'waiting', deliveredQuantity: 0 });
    expect(o.items[0]!.eta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ctx.notes.sent.map(m => m.subject)).toEqual([`Pre-order ${o.reference} confirmed`]);

    await addStock(ctx, 'cod', 100, 2);   // partial restock
    await drainJobs(ctx);
    o = await getOrder(ctx, customer.id, id);
    expect(o.items[0]).toMatchObject({ status: 'waiting', deliveredQuantity: 2 });
    expect(o.status).toBe('awaiting_stock');

    await addStock(ctx, 'cod', 100, 5);
    await drainJobs(ctx);
    o = await getOrder(ctx, customer.id, id);
    expect(o.status).toBe('completed');
    expect(o.items[0]!.codes).toHaveLength(3);
    expect((await one(ctx.db, `SELECT codes_available FROM product_stock WHERE product_id = $1`, [o.items[0]!.productId])).codes_available).toBe(4);
  });

  it('restock serves the oldest pre-order first', async () => {
    const a = await newCustomer(ctx), b = await newCustomer(ctx);
    const first = await buy(ctx, a.customer, [{ brandId: 'razer', faceValueUsd: 50, quantity: 1 }]);
    const second = await buy(ctx, b.customer, [{ brandId: 'razer', faceValueUsd: 50, quantity: 1 }]);
    await addStock(ctx, 'razer', 50, 1);
    await drainJobs(ctx);
    expect((await getOrder(ctx, a.customer.id, first)).status).toBe('completed');
    expect((await getOrder(ctx, b.customer.id, second)).status).toBe('awaiting_stock');
  });

  it('uploads skip duplicates and bad codes', async () => {
    const pid = await productId(ctx, 'xbox', 50);
    const r1 = await uploadCodes(ctx, null, pid, [{ code: 'AAAA-BBBB-CCCC' }, { code: 'aaaa bbbb cccc' }, { code: 'x' }]);
    expect(r1.added).toBe(1);
    expect(r1.rejected.map(x => x.reason).sort()).toEqual(['invalid', 'repeated_in_upload']);
    const r2 = await uploadCodes(ctx, null, pid, [{ code: 'AAAABBBBCCCC' }]);
    expect(r2).toMatchObject({ added: 0, rejected: [{ reason: 'already_in_stock', code: '****CCCC' }] });
  });

  it('20 customers racing for 5 codes: no code is ever given twice', async () => {
    await addStock(ctx, 'spotify', 50, 5);
    const buyers = await Promise.all(Array.from({ length: 20 }, () => newCustomer(ctx)));
    const orders = await Promise.all(buyers.map(b => createOrder(ctx, b.customer, { items: [{ brandId: 'spotify', faceValueUsd: 50, quantity: 1 }] })));
    await Promise.all(orders.map((o, i) => payFor(ctx, buyers[i]!.customer, o.id)));
    // several workers at once
    await Promise.all([drainJobs(ctx), drainJobs(ctx), drainJobs(ctx), drainJobs(ctx)]);
    const sold = await many(ctx.db, `SELECT order_item_id FROM gift_codes WHERE status = 'sold'`);
    expect(sold).toHaveLength(5);
    expect(new Set(sold.map(s => s.order_item_id)).size).toBe(5);
    const states = await many(ctx.db, `SELECT status, count(*)::int n FROM orders GROUP BY status ORDER BY status`);
    expect(states).toEqual([{ status: 'awaiting_stock', n: 15 }, { status: 'completed', n: 5 }]);
  });
});

describe('fulfilment through a provider (Wupex stand-in)', () => {
  beforeEach(() => reset(ctx, { withProvider: true }));

  it('stock first, provider for the rest, with cost and API log recorded', async () => {
    const { customer } = await newCustomer(ctx);
    await addStock(ctx, 'netflix', 100, 1);
    const id = await buy(ctx, customer, [{ brandId: 'netflix', faceValueUsd: 100, quantity: 3 }]);
    const o = await getOrder(ctx, customer.id, id);
    expect(o.status).toBe('completed');
    expect(o.items[0]!.codes).toHaveLength(3);
    const po = await one(ctx.db, `SELECT * FROM provider_orders`);
    expect(po).toMatchObject({ status: 'succeeded', quantity: 2, total_cost_cents: 2 * 9800, custom_identifier: `${o.reference}-1-1` });
    expect((await one(ctx.db, `SELECT balance_cents FROM providers WHERE id = 'mock'`)).balance_cents).toBe(1_000_000 - 19_600);
    expect((await one(ctx.db, `SELECT count(*)::int n FROM gift_codes WHERE source = 'provider' AND status = 'sold'`)).n).toBe(2);
    const log = await many(ctx.db, `SELECT * FROM provider_api_calls`);
    expect(log.length).toBeGreaterThan(0);
    expect(JSON.stringify(log)).not.toContain(o.items[0]!.codes[1]!.code);   // codes never in logs
  });

  it('provider refuses: the line waits as a pre-order', async () => {
    const { customer } = await newCustomer(ctx);
    ctx.mock.next = ['fail'];
    const id = await buy(ctx, customer, [{ brandId: 'apple', faceValueUsd: 50, quantity: 1 }]);
    expect((await getOrder(ctx, customer.id, id)).status).toBe('awaiting_stock');
    expect((await one(ctx.db, `SELECT status FROM provider_orders`)).status).toBe('failed');
  });

  it('not enough provider balance: skipped without calling the provider', async () => {
    const { customer } = await newCustomer(ctx);
    await ctx.db.query(`UPDATE providers SET balance_cents = 1000`);
    const o = await createOrder(ctx, customer, { items: [{ brandId: 'apple', faceValueUsd: 50, quantity: 1 }] });
    await payFor(ctx, customer, o.id);
    await drainJobs(ctx);
    expect(ctx.mock.calls).toBe(0);
    expect((await getOrder(ctx, customer.id, o.id)).status).toBe('awaiting_stock');
  });

  it('timeout AFTER the provider charged us: we look it up and deliver, never buy twice', async () => {
    const { customer } = await newCustomer(ctx);
    ctx.mock.next = ['timeout_after_charge'];
    const id = await buy(ctx, customer, [{ brandId: 'pubg', faceValueUsd: 50, quantity: 2 }]);
    // reconcile job is delayed 30s: bring it forward and run it
    await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'queued'`);
    await drainJobs(ctx);
    const o = await getOrder(ctx, customer.id, id);
    expect(o.status).toBe('completed');
    expect(o.items[0]!.codes).toHaveLength(2);
    expect(ctx.mock.calls).toBe(1);   // exactly one purchase
    expect(ctx.mock.orders.size).toBe(1);
    expect((await one(ctx.db, `SELECT status FROM provider_orders`)).status).toBe('succeeded');
  });

  it('timeout BEFORE the provider got it: confirmed missing, then bought once more', async () => {
    const { customer } = await newCustomer(ctx);
    ctx.mock.next = ['timeout_before_charge'];
    const id = await buy(ctx, customer, [{ brandId: 'pubg', faceValueUsd: 100, quantity: 1 }]);
    expect((await getOrder(ctx, customer.id, id)).status).toBe('awaiting_stock');
    await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'queued'`);
    await drainJobs(ctx);
    const o = await getOrder(ctx, customer.id, id);
    expect(o.status).toBe('completed');
    const pos = await many(ctx.db, `SELECT status, custom_identifier FROM provider_orders ORDER BY created_at`);
    expect(pos).toEqual([
      { status: 'failed', custom_identifier: `${o.reference}-1-1` },
      { status: 'succeeded', custom_identifier: `${o.reference}-1-2` }
    ]);
    expect(ctx.mock.orders.size).toBe(1);
  });

  it('provider still processing: delivered once it finishes', async () => {
    const { customer } = await newCustomer(ctx);
    ctx.mock.next = ['processing'];
    const id = await buy(ctx, customer, [{ brandId: 'googleplay', faceValueUsd: 50, quantity: 1 }]);
    expect((await getOrder(ctx, customer.id, id)).status).toBe('awaiting_stock');
    await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'queued'`);
    await drainJobs(ctx);
    expect((await getOrder(ctx, customer.id, id)).status).toBe('completed');
  });
});
