import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeCtx, reset, newCustomer, addStock, productId } from './helpers.js';
import { getCatalog } from '../src/services/catalog.js';
import { cancelOrder, createOrder, getOrder, listOrders } from '../src/services/orders.js';
import { one } from '../src/db/pool.js';

const ctx = makeCtx();
afterAll(() => ctx.db.end());
beforeEach(() => reset(ctx));

describe('catalog', () => {
  it('prices every card from the rate and shows availability', async () => {
    await addStock(ctx, 'netflix', 50, 8);   // above the low-stock threshold (5)
    await addStock(ctx, 'netflix', 100, 2);  // low
    const c = await getCatalog(ctx.db);
    const nf = c.brands.find(b => b.id === 'netflix')!;
    const by = (usd: number) => nf.products.find(p => p.faceValueUsd === usd)!;
    expect(by(50)).toMatchObject({ priceMinor: 1_325_000, availability: 'in_stock', maxQty: 8, restockEta: null });
    expect(by(100)).toMatchObject({ priceMinor: 2_650_000, availability: 'low', maxQty: 2 });
    expect(by(150)).toMatchObject({ availability: 'out_of_stock', maxQty: 10 });   // pre-order allowed
    expect(by(150).restockEta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.home.popular).toContain('netflix');
    expect(c.home.banners[0]!.brandId).toBe('playstation');
    expect(c.brands.find(b => b.id === 'ecards')!.hidden).toBe(true);
  });

  it('a ready provider means in stock; a provider without balance does not', async () => {
    await reset(ctx, { withProvider: true });
    let c = await getCatalog(ctx.db);
    expect(c.brands.find(b => b.id === 'xbox')!.products.every(p => p.availability === 'in_stock')).toBe(true);
    await ctx.db.query(`UPDATE providers SET balance_cents = 100`);
    c = await getCatalog(ctx.db);
    expect(c.brands.find(b => b.id === 'xbox')!.products.every(p => p.availability === 'out_of_stock')).toBe(true);
  });

  it('follows rate changes, price overrides and switched-off products', async () => {
    await ctx.db.query(`UPDATE app_settings SET usd_etb_rate = 270`);
    const pid = await productId(ctx, 'steam', 100);
    await ctx.db.query(`UPDATE products SET price_override_minor = 2_500_000 WHERE id = $1`, [pid]);
    await ctx.db.query(`UPDATE products SET is_active = false WHERE brand_id = 'steam' AND face_value_cents = 5000`);
    const steam = (await getCatalog(ctx.db)).brands.find(b => b.id === 'steam')!;
    expect(steam.products.map(p => p.faceValueUsd)).toEqual([100, 150, 200]);
    expect(steam.products[0]!.priceMinor).toBe(2_500_000);
    expect(steam.products[1]!.priceMinor).toBe(150 * 270 * 100);
  });
});

describe('creating orders', () => {
  it('prices on the server, merges duplicate lines, includes VAT', async () => {
    const { customer } = await newCustomer(ctx);
    const pid = await productId(ctx, 'netflix', 50);
    const o = await createOrder(ctx, customer, { items: [
      { brandId: 'netflix', faceValueUsd: 50, quantity: 1 }, { productId: pid, quantity: 2 }, { brandId: 'xbox', faceValueUsd: 100, quantity: 1 }
    ] });
    expect(o.status).toBe('pending_payment');
    expect(o.reference).toMatch(/^EC\d{8}$/);
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toMatchObject({ title: 'Netflix 50 USD', quantity: 3, unitPriceMinor: 1_325_000, status: 'pending' });
    expect(o.totalMinor).toBe(3 * 1_325_000 + 2_650_000);
    expect(o.subtotalMinor + o.vatMinor).toBe(o.totalMinor);
    expect(o.vatMinor).toBe(Math.round(o.totalMinor * 0.15 / 1.15));
    expect(o.delivery).toEqual({ by: 'sms', to: customer.msisdn });
  });

  it('rejects unknown, hidden or switched-off cards, and bad quantities', async () => {
    const { customer } = await newCustomer(ctx);
    await expect(createOrder(ctx, customer, { items: [{ brandId: 'netflix', faceValueUsd: 75, quantity: 1 }] })).rejects.toMatchObject({ code: 'product_unavailable' });
    await expect(createOrder(ctx, customer, { items: [{ brandId: 'ecards', faceValueUsd: 50, quantity: 1 }] })).rejects.toMatchObject({ code: 'product_unavailable' });
    await ctx.db.query(`UPDATE brands SET is_active = false WHERE id = 'spotify'`);
    await expect(createOrder(ctx, customer, { items: [{ brandId: 'spotify', faceValueUsd: 50, quantity: 1 }] })).rejects.toMatchObject({ code: 'product_unavailable' });
    await expect(createOrder(ctx, customer, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 11 }] })).rejects.toMatchObject({ code: 'qty_over_limit' });
    await expect(createOrder(ctx, customer, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 6 }, { brandId: 'netflix', faceValueUsd: 50, quantity: 5 }] })).rejects.toMatchObject({ code: 'qty_over_limit' });
    await expect(createOrder(ctx, customer, { items: [] })).rejects.toMatchObject({ code: 'cart_empty' });
  });

  it('validates where the codes go', async () => {
    const { customer } = await newCustomer(ctx);
    const items = [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }];
    await expect(createOrder(ctx, customer, { items, deliverBy: 'email' })).rejects.toMatchObject({ code: 'emailNeeded' });
    await expect(createOrder(ctx, customer, { items, deliverBy: 'email', deliverTo: 'nope@x' })).rejects.toMatchObject({ code: 'emailInvalid' });
    await expect(createOrder(ctx, customer, { items, deliverBy: 'sms', deliverTo: '0812345678' })).rejects.toMatchObject({ code: 'phoneInvalid' });
    const o = await createOrder(ctx, customer, { items, deliverBy: 'sms', deliverTo: '0911 223 344' });
    expect(o.delivery.to).toBe('+251911223344');
  });

  it('the same idempotency key never creates two orders, even at the same moment', async () => {
    const { customer } = await newCustomer(ctx);
    const input = { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }], idempotencyKey: 'tap-123' };
    const results = await Promise.all(Array.from({ length: 5 }, () => createOrder(ctx, customer, input)));
    expect(new Set(results.map(r => r.id)).size).toBe(1);
    expect((await one(ctx.db, `SELECT count(*)::int n FROM orders`)).n).toBe(1);
  });

  it('customers only see their own orders', async () => {
    const a = await newCustomer(ctx), b = await newCustomer(ctx);
    const o = await createOrder(ctx, a.customer, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }] });
    await expect(getOrder(ctx, b.customer.id, o.id)).rejects.toMatchObject({ code: 'order_not_found' });
    await expect(getOrder(ctx, b.customer.id, o.reference)).rejects.toMatchObject({ code: 'order_not_found' });
    expect((await getOrder(ctx, a.customer.id, o.reference)).id).toBe(o.id);
    expect(await listOrders(ctx, b.customer.id)).toHaveLength(0);
    expect(await listOrders(ctx, a.customer.id)).toHaveLength(1);
  });

  it('unpaid orders can be cancelled', async () => {
    const { customer } = await newCustomer(ctx);
    const o = await createOrder(ctx, customer, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }] });
    await cancelOrder(ctx, customer.id, o.id);
    expect((await getOrder(ctx, customer.id, o.id)).status).toBe('cancelled');
    await expect(cancelOrder(ctx, customer.id, o.id)).rejects.toMatchObject({ code: 'order_not_cancellable' });
  });
});
