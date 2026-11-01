import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeCtx, reset, newCustomer, buy, drainJobs, payFor } from './helpers.js';
import { startFakeWupex } from './fakes/wupex.js';
import { WupexProvider, faceValueCents } from '../src/adapters/giftcards/wupex.js';
import { ProviderUnknownError } from '../src/adapters/giftcards/types.js';
import { syncProvider } from '../src/services/admin.js';
import { applyMappings, suggestMappings } from '../src/services/providerMapping.js';
import { createOrder, getOrder } from '../src/services/orders.js';
import { many, one } from '../src/db/pool.js';

let fake: Awaited<ReturnType<typeof startFakeWupex>>;
let wupex: WupexProvider;
let ctx: ReturnType<typeof makeCtx>;

beforeAll(async () => {
  fake = await startFakeWupex({ slowMs: 700 });
  wupex = new WupexProvider({ baseUrl: fake.url, apiKey: fake.apiKey, merchant: 'ECARDS', timeoutMs: 300, settleSecs: 0 });
  ctx = makeCtx({ providers: { wupex } });
});
afterAll(async () => { await fake.close(); await ctx.db.end(); });

/** Fresh catalog with Wupex as the only provider, synced and mapped. */
async function setupWupex() {
  await reset(ctx);
  fake.state.orders.length = 0; fake.state.next = []; fake.state.balance = 5000;
  await ctx.db.query(`INSERT INTO providers (id, name, adapter, is_active, status) VALUES ('wupex', 'Wupex', 'wupex', true, 'ok')`);
  const s = await syncProvider(ctx, null, 'wupex');
  expect(s).toMatchObject({ ok: true, products: 11, balanceCents: 500000 });
  await applyMappings(ctx, null, 'wupex', await suggestMappings(ctx, 'wupex'));
}

describe('Wupex adapter (against a server that answers like the docs)', () => {
  it('reads face values out of SKUs and names', () => {
    expect(faceValueCents('NETFLIX-USA-50USD')).toBe(5000);
    expect(faceValueCents('x', 'Google Play $10 Gift Card (USA)')).toBe(1000);
    expect(faceValueCents('STEAM-USA-12.50USD')).toBe(1250);
    expect(faceValueCents('NO-VALUE')).toBeUndefined();
  });

  it('balance, paged product list, purchase with codes', async () => {
    fake.state.next = [];
    expect(await wupex.getBalance()).toMatchObject({ currency: 'USD' });
    const items = await wupex.listProducts();
    expect(items).toHaveLength(11);
    expect(items[0]).toMatchObject({ externalId: 'NETFLIX-USA-50USD', country: 'USA', denominationsCents: [5000], priceCents: 5000, discountPct: 3, available: true });
    const r = await wupex.placeOrder({ externalProductId: 'STEAM-USA-50USD', quantity: 2, unitFaceValueCents: 5000, customIdentifier: 'EC1-1-1' });
    expect(r.status).toBe('succeeded');
    if (r.status === 'succeeded') {
      expect(r.cards).toHaveLength(2);
      expect(r.cards[0]!.serial).toMatch(/^SN-/);
      expect(r.totalCostCents).toBe(9700);
    }
    expect(fake.state.calls).toContain('POST /api/order/pull-codes');
  });

  it('turns errors into the right outcome', async () => {
    fake.state.next = ['insufficient'];
    expect(await wupex.placeOrder({ externalProductId: 'STEAM-USA-50USD', quantity: 1, unitFaceValueCents: 5000, customIdentifier: 'x' }))
      .toMatchObject({ status: 'failed', retryable: true });
    fake.state.next = ['error500'];
    await expect(wupex.placeOrder({ externalProductId: 'STEAM-USA-50USD', quantity: 1, unitFaceValueCents: 5000, customIdentifier: 'x' })).rejects.toBeInstanceOf(ProviderUnknownError);
    fake.state.next = ['slow_after_charge'];
    await expect(wupex.placeOrder({ externalProductId: 'STEAM-USA-50USD', quantity: 1, unitFaceValueCents: 5000, customIdentifier: 'x' })).rejects.toBeInstanceOf(ProviderUnknownError);
    const bad = new WupexProvider({ baseUrl: fake.url, apiKey: 'wrong', merchant: 'ECARDS' });
    expect(await bad.placeOrder({ externalProductId: 'STEAM-USA-50USD', quantity: 1, unitFaceValueCents: 5000, customIdentifier: 'x' }))
      .toMatchObject({ status: 'failed', retryable: false });
  });
});

describe('mapping our cards to Wupex SKUs', () => {
  beforeEach(setupWupex);

  it('pairs brand + value, prefers US cards, records cost after discount', async () => {
    const rows = await suggestMappings(ctx, 'wupex');
    const by = (b: string, v: number) => rows.find(r => r.brandId === b && r.valueUsd === v)!;
    expect(by('netflix', 50)).toMatchObject({ externalId: 'NETFLIX-USA-50USD', costCents: 4850 });   // USA preferred over TUR
    expect(by('playstation', 50).externalId).toBe('PSN-USA-50USD');
    expect(by('pubg', 50).externalId).toBe('PUBG-GLOBAL-50USD');
    expect(by('cod', 50)).toMatchObject({ externalId: null, note: 'no matching product at the provider' });
    expect(by('spotify', 50).externalId).toBeNull();   // Wupex only has $30 Spotify
    const saved = await one(ctx.db, `SELECT count(*)::int n FROM product_sources WHERE provider_id = 'wupex'`);
    expect(saved.n).toBe(rows.filter(r => r.externalId).length);
  });
});

describe('buying through Wupex', () => {
  beforeEach(setupWupex);

  it('a paid order gets Wupex codes; cost and order name are recorded', async () => {
    const { customer } = await newCustomer(ctx);
    const id = await buy(ctx, customer, [{ brandId: 'netflix', faceValueUsd: 50, quantity: 2 }]);
    const o = await getOrder(ctx, customer.id, id);
    expect(o.status).toBe('completed');
    const sent = fake.state.orders[0]!;
    expect(o.items[0]!.codes.map(c => c.code).sort()).toEqual([...sent.lines[0]!.codes].sort());
    expect(o.items[0]!.codes[0]!.serial).toMatch(/^SN-/);
    const po = await one(ctx.db, `SELECT * FROM provider_orders`);
    expect(po).toMatchObject({ status: 'succeeded', external_transaction_id: sent.orderName, total_cost_cents: 9700 });
    expect(po.request_context).toHaveProperty('markerId');
  });

  it('timeout AFTER Wupex charged: the order is found again and used, never bought twice', async () => {
    const { customer } = await newCustomer(ctx);
    fake.state.next = ['slow_after_charge'];
    const id = await buy(ctx, customer, [{ brandId: 'steam', faceValueUsd: 50, quantity: 1 }]);
    expect((await getOrder(ctx, customer.id, id)).status).toBe('awaiting_stock');
    expect((await one(ctx.db, `SELECT status FROM provider_orders`)).status).toBe('unknown');
    await new Promise(r => setTimeout(r, 800));   // let the slow answer finish on the fake server
    await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'queued'`);
    await drainJobs(ctx);
    const o = await getOrder(ctx, customer.id, id);
    expect(o.status).toBe('completed');
    expect(fake.state.orders).toHaveLength(1);   // exactly one purchase at Wupex
    expect(o.items[0]!.codes[0]!.code).toBe(fake.state.orders[0]!.lines[0]!.codes[0]);
  });

  it('timeout BEFORE Wupex got it: confirmed missing, bought once more', async () => {
    const { customer } = await newCustomer(ctx);
    fake.state.next = ['slow_before_charge'];
    const id = await buy(ctx, customer, [{ brandId: 'xbox', faceValueUsd: 50, quantity: 1 }]);
    await new Promise(r => setTimeout(r, 800));
    await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'queued'`);
    await drainJobs(ctx);
    await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'queued'`);
    await drainJobs(ctx);
    expect((await getOrder(ctx, customer.id, id)).status).toBe('completed');
    expect(fake.state.orders).toHaveLength(1);
    expect((await many(ctx.db, `SELECT status FROM provider_orders ORDER BY created_at`)).map(x => x.status)).toEqual(['failed', 'succeeded']);
  });

  it('while a purchase is unresolved, no other Wupex purchase starts; both finish afterwards', async () => {
    const a = await newCustomer(ctx), b = await newCustomer(ctx);
    fake.state.next = ['slow_after_charge'];
    const first = await buy(ctx, a.customer, [{ brandId: 'googleplay', faceValueUsd: 50, quantity: 1 }]);
    const second = await buy(ctx, b.customer, [{ brandId: 'googleplay', faceValueUsd: 50, quantity: 1 }]);
    expect(fake.state.orders).toHaveLength(1);   // the second waited
    expect((await getOrder(ctx, b.customer.id, second)).status).toBe('awaiting_stock');
    await new Promise(r => setTimeout(r, 800));
    for (let i = 0; i < 4; i++) { await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'queued'`); await drainJobs(ctx); }
    expect((await getOrder(ctx, a.customer.id, first)).status).toBe('completed');
    expect((await getOrder(ctx, b.customer.id, second)).status).toBe('completed');
    expect(fake.state.orders).toHaveLength(2);
    const names = (await many(ctx.db, `SELECT external_transaction_id t FROM provider_orders WHERE status = 'succeeded'`)).map(x => x.t);
    expect(new Set(names).size).toBe(2);   // each Wupex order claimed once
  });

  it('Wupex answers without codes: they are fetched from the order detail', async () => {
    const { customer } = await newCustomer(ctx);
    fake.state.next = ['no_serials'];
    const id = await buy(ctx, customer, [{ brandId: 'apple', faceValueUsd: 50, quantity: 1 }]);
    await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE status = 'queued'`);
    await drainJobs(ctx);
    expect((await getOrder(ctx, customer.id, id)).status).toBe('completed');
    expect(fake.state.orders).toHaveLength(1);
  });

  it('out of stock at Wupex: the line waits as a pre-order, nothing charged', async () => {
    const { customer } = await newCustomer(ctx);
    fake.state.next = ['insufficient'];
    const o = await createOrder(ctx, customer, { items: [{ brandId: 'razer', faceValueUsd: 50, quantity: 1 }] });
    await payFor(ctx, customer, o.id);
    await drainJobs(ctx);
    expect((await getOrder(ctx, customer.id, o.id)).status).toBe('awaiting_stock');
    expect(fake.state.orders).toHaveLength(0);
  });
});
