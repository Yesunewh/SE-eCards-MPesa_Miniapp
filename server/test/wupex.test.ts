import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeCtx, reset, newCustomer, buy, drainJobs, payFor } from './helpers.js';
import { startFakeWupex } from './fakes/wupex.js';
import { WupexProvider, faceValueCents, wupexError } from '../src/adapters/giftcards/wupex.js';
import { ProviderUnknownError } from '../src/adapters/giftcards/types.js';
import { syncProvider } from '../src/services/admin.js';
import { addProviderValues, applyMappings, suggestMappings } from '../src/services/providerMapping.js';
import { createOrder, getOrder } from '../src/services/orders.js';
import { fulfilOrder, retryWaitingJob } from '../src/services/fulfilment.js';
import { many, one } from '../src/db/pool.js';

let fake: Awaited<ReturnType<typeof startFakeWupex>>;
let wupex: WupexProvider;
let ctx: ReturnType<typeof makeCtx>;

beforeAll(async () => {
  fake = await startFakeWupex({ slowMs: 700 });
  wupex = new WupexProvider({ baseUrl: fake.url, apiKey: fake.apiKey, merchant: 'Paperless345', timeoutMs: 300, settleSecs: 0 });
  ctx = makeCtx({ providers: { wupex } });
});
afterAll(async () => { await fake.close(); await ctx.db.end(); });

const resetFake = () => {
  fake.state.orders.length = 0; fake.state.next = []; fake.state.balance = 0; fake.state.credit = 5000; fake.state.calls.length = 0;
  for (const p of fake.state.products) { p.available = 50; p.preorder = true; }
};
const stock = (sku: string, available: number, preorder = true) => {
  const p = fake.state.products.find(x => x.productCode === sku)!; p.available = available; p.preorder = preorder;
};
/** run every queued job now, a few rounds (lookups reschedule themselves) */
async function settle(rounds = 4) {
  for (let i = 0; i < rounds; i++) { await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'queued'`); await drainJobs(ctx); }
}

/** Fresh catalog with Wupex as the only provider, synced and mapped. */
async function setupWupex() {
  await reset(ctx);
  resetFake();
  await ctx.db.query(`INSERT INTO providers (id, name, adapter, is_active, status) VALUES ('wupex', 'Wupex', 'wupex', true, 'ok')`);
  const s = await syncProvider(ctx, null, 'wupex');
  expect(s).toMatchObject({ ok: true, products: 11, balanceCents: 500000 });   // the top-up product is left out
  await applyMappings(ctx, null, 'wupex', await suggestMappings(ctx, 'wupex'));
}

describe('Wupex adapter (against a server that answers like the sandbox)', () => {
  beforeEach(resetFake);

  it('reads face values and error descriptions', () => {
    expect(faceValueCents('NETFLIX-USA-50USD')).toBe(5000);
    expect(faceValueCents('x', 'Google Play $10 Gift Card (USA)')).toBe(1000);
    expect(faceValueCents('STEAM-USA-12.50USD')).toBe(1250);
    expect(faceValueCents('NO-VALUE')).toBeUndefined();
    expect(wupexError({ status: false, description: '[PRICE_REVIEW_REQUIRED] Product X: review' }, 200)).toEqual({ code: 'PRICE_REVIEW_REQUIRED', message: 'Product X: review' });
    expect(wupexError({ status: false, description: 'RequestId:c03 | Insufficient Stock', validateError: { product: ['x'] } }, 200).code).toBe('INSUFFICIENT_STOCK');
    expect(wupexError({ status: false, description: 'File not found.' }, 200).code).toBe('NOT_FOUND');
  });

  it('spendable balance, product list (vouchers only), purchase with codes read from the order', async () => {
    expect(await wupex.getBalance()).toEqual({ balanceCents: 500000, currency: 'USD' });   // creditBalance, not the (negative) balance
    const items = await wupex.listProducts();
    expect(items).toHaveLength(11);
    expect(items[0]).toMatchObject({ externalId: 'NETFLIX-USA-50USD', country: 'USA', denominationsCents: [5000], priceCents: 4850, discountPct: 3, available: true });
    expect(await wupex.preorderEnabled()).toBe(true);
    const r = await wupex.placeOrder({ externalProductId: 'STEAM-USA-50USD', quantity: 2, unitFaceValueCents: 5000, customIdentifier: 'EC1-1-1' });
    expect(r).toMatchObject({ status: 'succeeded', remaining: 0, totalCostCents: 9700 });
    if (r.status === 'succeeded') expect(r.cards.map(c => c.code)).toEqual(fake.state.orders[0]!.codes);
    expect(fake.state.calls).toContain('POST /api/order/pull-codes?referenceId=EC1-1-1&allowTakeAll=true');
    expect(fake.state.calls).toContain(`GET /api/order/detail?orderName=${fake.state.orders[0]!.orderName}`);
  });

  it('the same referenceId twice buys once and returns the same codes', async () => {
    const input = { externalProductId: 'APPLE-USA-50USD', quantity: 1, unitFaceValueCents: 5000, customIdentifier: 'EC2-1-1' };
    const a = await wupex.placeOrder(input), b = await wupex.placeOrder(input);
    expect(fake.state.orders).toHaveLength(1);
    expect(fake.state.balance).toBe(-48.5);
    expect(b).toEqual(a);
    expect(await wupex.findOrder('EC2-1-1', { externalProductId: 'x', quantity: 1, placedAt: new Date(), prepared: {}, claimed: [] })).toEqual(a);
  });

  it('turns errors into the right outcome', async () => {
    const buy1 = () => wupex.placeOrder({ externalProductId: 'STEAM-USA-50USD', quantity: 1, unitFaceValueCents: 5000, customIdentifier: 'x' + Math.random() });
    fake.state.next = ['insufficient'];
    expect(await buy1()).toMatchObject({ status: 'failed', retryable: true });
    fake.state.next = ['price_review'];
    expect(await buy1()).toMatchObject({ status: 'failed', retryable: false, reason: expect.stringMatching(/^PRICE_REVIEW_REQUIRED/) });
    fake.state.next = ['error500'];
    await expect(buy1()).rejects.toBeInstanceOf(ProviderUnknownError);
    fake.state.next = ['slow_after_charge'];
    await expect(buy1()).rejects.toBeInstanceOf(ProviderUnknownError);
    const bad = new WupexProvider({ baseUrl: fake.url, apiKey: 'wrong', merchant: 'Paperless345' });
    expect(await bad.placeOrder({ externalProductId: 'STEAM-USA-50USD', quantity: 1, unitFaceValueCents: 5000, customIdentifier: 'y' }))
      .toMatchObject({ status: 'failed', retryable: false });
  });

  it('short stock: what Wupex has now, the rest as a Wupex pre-order', async () => {
    stock('XBOX-USA-50USD', 1);
    const r = await wupex.placeOrder({ externalProductId: 'XBOX-USA-50USD', quantity: 3, unitFaceValueCents: 5000, customIdentifier: 'EC3-1-1' });
    expect(r).toMatchObject({ status: 'succeeded', remaining: 2 });
    if (r.status === 'succeeded') expect(r.cards).toHaveLength(1);
    stock('XBOX-USA-50USD', 0);
    expect(await wupex.placeOrder({ externalProductId: 'XBOX-USA-50USD', quantity: 1, unitFaceValueCents: 5000, customIdentifier: 'EC4-1-1' }))
      .toMatchObject({ status: 'processing', retryAfterSecs: 120, preorder: true });
  });
});

describe('mapping our cards to Wupex SKUs', () => {
  beforeEach(setupWupex);

  it('pairs brand + value, prefers US cards, records the Wupex price as cost', async () => {
    const rows = await suggestMappings(ctx, 'wupex');
    const by = (b: string, v: number) => rows.find(r => r.brandId === b && r.valueUsd === v)!;
    expect(by('netflix', 50)).toMatchObject({ externalId: 'NETFLIX-USA-50USD', costCents: 4850 });   // USA preferred over TUR
    expect(by('playstation', 50).externalId).toBe('PS-USA-50USD');
    expect(by('pubg', 50).externalId).toBe('PUBG-GLOBAL-50USD');
    expect(by('cod', 50)).toMatchObject({ externalId: null, note: 'no matching product at the provider' });
    expect(by('spotify', 50).externalId).toBeNull();   // Wupex only has $30 Spotify
    const saved = await one(ctx.db, `SELECT count(*)::int n FROM product_sources WHERE provider_id = 'wupex'`);
    expect(saved.n).toBe(rows.filter(r => r.externalId).length);
  });

  it('adds the values Wupex sells in brands we carry, and names the brands we do not carry', async () => {
    await ctx.db.query(`INSERT INTO provider_products (provider_id, external_id, name, brand_name, currency, denominations_cents, is_available)
                        VALUES ('wupex', 'ROBLOX-USA-25USD', 'Roblox Gift Card $25 (USA)', 'Roblox', 'USD', '{2500}', true)`);
    const v = await addProviderValues(ctx, null, 'wupex');
    expect(v.added).toEqual(['spotify $30']);   // every other Wupex value already exists in our catalogue
    expect(v.brandsNotCarried).toEqual(['Roblox']);
    expect((await addProviderValues(ctx, null, 'wupex')).added).toEqual([]);   // running it again adds nothing
    const rows = await suggestMappings(ctx, 'wupex');
    expect(rows.find(r => r.brandId === 'spotify' && r.valueUsd === 30)?.externalId).toBe('SPOTIFY-USA-30USD');
  });
});

describe('buying through Wupex', () => {
  beforeEach(setupWupex);

  it('a paid order gets Wupex codes; our reference, cost and order name are recorded', async () => {
    const { customer } = await newCustomer(ctx);
    const id = await buy(ctx, customer, [{ brandId: 'netflix', faceValueUsd: 50, quantity: 2 }]);
    const o = await getOrder(ctx, customer.id, id);
    expect(o.status).toBe('completed');
    const sent = fake.state.orders[0]!;
    expect(o.items[0]!.codes.map(c => c.code).sort()).toEqual([...sent.codes].sort());
    expect(o.items[0]!.codes[0]!.serial).toMatch(/^SN-/);
    const po = await one(ctx.db, `SELECT * FROM provider_orders`);
    expect(po).toMatchObject({ status: 'succeeded', external_transaction_id: sent.orderName, total_cost_cents: 9700 });
    expect(sent.referenceId).toBe(po.custom_identifier);
  });

  it('timeout AFTER Wupex charged: found by our reference and used, never bought twice', async () => {
    const { customer } = await newCustomer(ctx);
    fake.state.next = ['slow_after_charge'];
    const id = await buy(ctx, customer, [{ brandId: 'steam', faceValueUsd: 50, quantity: 1 }]);
    expect((await getOrder(ctx, customer.id, id)).status).toBe('awaiting_stock');
    expect((await one(ctx.db, `SELECT status FROM provider_orders`)).status).toBe('unknown');
    await new Promise(r => setTimeout(r, 800));   // let the slow answer finish on the fake server
    await settle();
    const o = await getOrder(ctx, customer.id, id);
    expect(o.status).toBe('completed');
    expect(fake.state.orders).toHaveLength(1);   // exactly one purchase at Wupex
    expect(o.items[0]!.codes[0]!.code).toBe(fake.state.orders[0]!.codes[0]);
    expect((await many(ctx.db, `SELECT template FROM notifications`)).map(n => n.template)).toContain('codes_delivered');
  });

  it('timeout BEFORE Wupex got it: confirmed missing, bought once more', async () => {
    const { customer } = await newCustomer(ctx);
    fake.state.next = ['slow_before_charge'];
    const id = await buy(ctx, customer, [{ brandId: 'xbox', faceValueUsd: 50, quantity: 1 }]);
    await new Promise(r => setTimeout(r, 800));
    await settle();
    expect((await getOrder(ctx, customer.id, id)).status).toBe('completed');
    expect(fake.state.orders).toHaveLength(1);
    expect((await many(ctx.db, `SELECT status FROM provider_orders ORDER BY created_at`)).map(x => x.status)).toEqual(['failed', 'succeeded']);
  });

  it('purchases no longer wait for each other: a slow one does not hold up the next customer', async () => {
    const a = await newCustomer(ctx), b = await newCustomer(ctx);
    fake.state.next = ['slow_after_charge'];
    const first = await buy(ctx, a.customer, [{ brandId: 'googleplay', faceValueUsd: 50, quantity: 1 }]);
    const second = await buy(ctx, b.customer, [{ brandId: 'googleplay', faceValueUsd: 50, quantity: 1 }]);
    expect((await getOrder(ctx, b.customer.id, second)).status).toBe('completed');
    await new Promise(r => setTimeout(r, 800));
    await settle();
    expect((await getOrder(ctx, a.customer.id, first)).status).toBe('completed');
    expect(fake.state.orders).toHaveLength(2);
    const names = (await many(ctx.db, `SELECT external_transaction_id t FROM provider_orders WHERE status = 'succeeded'`)).map(x => x.t);
    expect(new Set(names).size).toBe(2);
  });

  it('Wupex pre-order: codes in stock now, the rest delivered to the customer as Wupex gets them', async () => {
    stock('APPLE-USA-50USD', 1);
    const { customer } = await newCustomer(ctx);
    const id = await buy(ctx, customer, [{ brandId: 'apple', faceValueUsd: 50, quantity: 3 }]);
    let o = await getOrder(ctx, customer.id, id);
    expect(o).toMatchObject({ status: 'awaiting_stock' });
    expect(o.items[0]).toMatchObject({ deliveredQuantity: 1, status: 'waiting' });
    expect(await one(ctx.db, `SELECT status, total_cost_cents FROM provider_orders`)).toMatchObject({ status: 'partial', total_cost_cents: 4850 });
    const wo = fake.state.orders[0]!;
    // the periodic pre-order retry (or a restock elsewhere) runs meanwhile: it must not buy the same cards again
    expect(await retryWaitingJob(ctx)).toBe(1);
    await fulfilOrder(ctx, id);
    expect(fake.state.orders).toHaveLength(1);

    fake.supply(wo.orderName, 1);
    await settle(1);
    o = await getOrder(ctx, customer.id, id);
    expect(o.items[0]!.deliveredQuantity).toBe(2);

    fake.supply(wo.orderName, 1);
    await settle();
    o = await getOrder(ctx, customer.id, id);
    expect(o.status).toBe('completed');
    expect(o.items[0]!.codes.map(c => c.code).sort()).toEqual([...wo.codes].sort());
    expect(fake.state.orders).toHaveLength(1);   // one Wupex order the whole time
    expect(await one(ctx.db, `SELECT status, total_cost_cents FROM provider_orders`)).toMatchObject({ status: 'succeeded', total_cost_cents: 14550 });
    expect((await one(ctx.db, `SELECT count(*)::int n FROM gift_codes`)).n).toBe(3);
    expect((await one(ctx.db, `SELECT count(*)::int n FROM audit_log WHERE action = 'provider.duplicate_code'`)).n).toBe(0);
  });

  it('Wupex gives up on a pre-order: keep what came, nothing more charged, the line waits for our stock', async () => {
    stock('NETFLIX-USA-100USD', 1);
    const { customer } = await newCustomer(ctx);
    const id = await buy(ctx, customer, [{ brandId: 'netflix', faceValueUsd: 100, quantity: 2 }]);
    fake.failPreorder(fake.state.orders[0]!.orderName);
    stock('NETFLIX-USA-100USD', 0, false);   // and no more from Wupex for now
    await settle();
    const o = await getOrder(ctx, customer.id, id);
    expect(o).toMatchObject({ status: 'awaiting_stock' });
    expect(o.items[0]!.deliveredQuantity).toBe(1);
    expect((await many(ctx.db, `SELECT status FROM provider_orders ORDER BY created_at`)).map(x => x.status)[0]).toBe('succeeded');
    expect(fake.state.balance).toBe(-97);   // charged for one card only
  });

  it('Wupex pre-order with nothing in stock: tracked as an open pre-order (not an unknown outcome), delivered later', async () => {
    stock('STEAM-USA-50USD', 0);
    const { customer } = await newCustomer(ctx);
    const id = await buy(ctx, customer, [{ brandId: 'steam', faceValueUsd: 50, quantity: 1 }]);
    expect(await one(ctx.db, `SELECT status, external_transaction_id FROM provider_orders`)).toMatchObject({ status: 'partial', external_transaction_id: fake.state.orders[0]!.orderName });
    await settle(1);
    expect(await one(ctx.db, `SELECT status FROM provider_orders`)).toMatchObject({ status: 'partial' });
    fake.supply(fake.state.orders[0]!.orderName, 1);
    await settle();
    expect((await getOrder(ctx, customer.id, id)).status).toBe('completed');
    expect(fake.state.orders).toHaveLength(1);
  });

  it('out of stock and no Wupex pre-order: the line waits as our pre-order, nothing charged', async () => {
    stock('PUBG-GLOBAL-50USD', 0, false);
    const { customer } = await newCustomer(ctx);
    const o = await createOrder(ctx, customer, { items: [{ brandId: 'pubg', faceValueUsd: 50, quantity: 1 }] });
    await payFor(ctx, customer, o.id);
    await drainJobs(ctx);
    expect((await getOrder(ctx, customer.id, o.id)).status).toBe('awaiting_stock');
    expect(fake.state.orders).toHaveLength(0);
    expect(fake.state.balance).toBe(0);
  });
});
