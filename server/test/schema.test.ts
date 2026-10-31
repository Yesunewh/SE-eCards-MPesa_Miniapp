import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeCtx, reset, newCustomer, productId } from './helpers.js';
import { one } from '../src/db/pool.js';
import { BRAND_SEED, CARD_VALUES_USD } from '../src/db/seed.js';
import { seed } from '../src/db/seed.js';

const ctx = makeCtx();
afterAll(() => ctx.db.end());
beforeEach(() => reset(ctx));

/** Inserts a minimal order + one item, returns ids. */
async function rawOrder(customerId: string, total = 1325000) {
  const pid = await productId(ctx, 'netflix', 50);
  const o = await one(ctx.db, `INSERT INTO orders (reference, customer_id, subtotal_minor, vat_minor, total_minor, usd_etb_rate, vat_rate, deliver_by, deliver_to, expires_at)
    VALUES ('EC' || lpad((floor(random()*89999999)+10000000)::text, 8, '0'), $1, $2 - 172826, 172826, $2, 265, 0.15, 'sms', '+251711111111', now() + interval '15 min') RETURNING id`, [customerId, total]);
  const it = await one(ctx.db, `INSERT INTO order_items (order_id, line_no, product_id, brand_id, title, face_value_cents, quantity, unit_price_minor, line_total_minor)
    VALUES ($1, 1, $2, 'netflix', 'Netflix 50 USD', 5000, 1, 1325000, 1325000) RETURNING id`, [o.id, pid]);
  return { orderId: o.id as string, itemId: it.id as string, productId: pid };
}

describe('seed', () => {
  it('matches the demo catalog: 10 visible brands + eCards, 4 values each', async () => {
    const r = await one(ctx.db, `SELECT (SELECT count(*)::int FROM brands) b, (SELECT count(*)::int FROM products) p, (SELECT count(*)::int FROM brands WHERE is_hidden) h`);
    expect(r.b).toBe(BRAND_SEED.length);
    expect(r.h).toBe(1);
    expect(r.p).toBe((BRAND_SEED.length - 1) * CARD_VALUES_USD.length);
  });

  it('is idempotent and never overwrites admin edits', async () => {
    await ctx.db.query(`UPDATE brands SET name = 'Netflix ET' WHERE id = 'netflix'`);
    await ctx.db.query(`UPDATE app_settings SET usd_etb_rate = 300`);
    await seed(ctx.db);
    expect((await one(ctx.db, `SELECT name FROM brands WHERE id = 'netflix'`)).name).toBe('Netflix ET');
    expect((await one(ctx.db, `SELECT usd_etb_rate FROM app_settings`)).usd_etb_rate).toBe(300);
    expect((await one(ctx.db, `SELECT count(*)::int n FROM products`)).n).toBe(40);
  });
});

describe('constraints', () => {
  it('rejects non-Ethiopian or malformed phone numbers', async () => {
    await expect(ctx.db.query(`INSERT INTO customers (msisdn) VALUES ('+254712345678')`)).rejects.toThrow(/check/);
    await expect(ctx.db.query(`INSERT INTO customers (msisdn) VALUES ('0712345678')`)).rejects.toThrow(/check/);
    await ctx.db.query(`INSERT INTO customers (msisdn) VALUES ('+251912345678')`);
  });

  it('keeps order totals consistent (subtotal + VAT = total)', async () => {
    const { customer } = await newCustomer(ctx);
    await expect(ctx.db.query(`INSERT INTO orders (reference, customer_id, subtotal_minor, vat_minor, total_minor, usd_etb_rate, vat_rate, deliver_by, deliver_to, expires_at)
      VALUES ('EC12345678', $1, 100, 10, 999, 265, 0.15, 'sms', 'x', now())`, [customer.id])).rejects.toThrow(/check/);
  });

  it('keeps line totals and delivered quantity consistent', async () => {
    const { customer } = await newCustomer(ctx);
    const { orderId, itemId } = await rawOrder(customer.id);
    const pid = await productId(ctx, 'netflix', 50);
    await expect(ctx.db.query(`INSERT INTO order_items (order_id, line_no, product_id, brand_id, title, face_value_cents, quantity, unit_price_minor, line_total_minor)
      VALUES ($1, 2, $2, 'netflix', 'x', 5000, 2, 100, 150)`, [orderId, pid])).rejects.toThrow(/check/);
    await expect(ctx.db.query(`UPDATE order_items SET delivered_quantity = 2 WHERE id = $1`, [itemId])).rejects.toThrow(/check/);
    await expect(ctx.db.query(`UPDATE order_items SET status = 'delivered' WHERE id = $1`, [itemId])).rejects.toThrow(/check/);
  });

  it('a code is sold if and only if it belongs to an order line', async () => {
    const { customer } = await newCustomer(ctx);
    const { itemId, productId: pid } = await rawOrder(customer.id);
    const ins = (status: string, item: string | null) => ctx.db.query(`INSERT INTO gift_codes (product_id, source, code_enc, code_hmac, code_last4, status, order_item_id)
      VALUES ($1, 'upload', '\\x00', gen_random_uuid()::text::bytea, '0000', $2, $3)`, [pid, status, item]);
    await expect(ins('sold', null)).rejects.toThrow(/check/);
    await expect(ins('available', itemId)).rejects.toThrow(/check/);
    await ins('sold', itemId);
  });

  it('refuses the same code twice', async () => {
    const pid = await productId(ctx, 'netflix', 50);
    const ins = () => ctx.db.query(`INSERT INTO gift_codes (product_id, source, code_enc, code_hmac, code_last4) VALUES ($1,'upload','\\x00','\\xdeadbeef','0000')`, [pid]);
    await ins();
    await expect(ins()).rejects.toThrow(/duplicate key/);
  });

  it('allows one successful and one open payment per order at most', async () => {
    const { customer } = await newCustomer(ctx);
    const { orderId } = await rawOrder(customer.id);
    const pay = (status: string) => ctx.db.query(`INSERT INTO payments (order_id, status, amount_minor, msisdn) VALUES ($1, $2, 1325000, '+251711111111')`, [orderId, status]);
    await pay('pending');
    await expect(pay('initiated')).rejects.toThrow(/payments_one_open_uq/);
    await pay('succeeded');
    await expect(pay('succeeded')).rejects.toThrow(/payments_one_success_uq/);
    await pay('failed'); await pay('failed');   // any number of failed attempts
  });

  it('settings is a single row with sane values', async () => {
    await expect(ctx.db.query(`INSERT INTO app_settings (id, usd_etb_rate, vat_rate) VALUES (2, 1, 0.1)`)).rejects.toThrow(/check/);
    await expect(ctx.db.query(`UPDATE app_settings SET vat_rate = 1.5`)).rejects.toThrow(/check/);
    await expect(ctx.db.query(`UPDATE app_settings SET usd_etb_rate = 0`)).rejects.toThrow(/check/);
  });

  it('maintains updated_at', async () => {
    const before = (await one(ctx.db, `SELECT updated_at FROM brands WHERE id='xbox'`)).updated_at;
    await new Promise(r => setTimeout(r, 20));
    await ctx.db.query(`UPDATE brands SET name = 'Xbox' WHERE id = 'xbox'`);
    const after = (await one(ctx.db, `SELECT updated_at FROM brands WHERE id='xbox'`)).updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});
