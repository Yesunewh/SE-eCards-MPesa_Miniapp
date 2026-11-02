import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeCtx, reset, addStock, drainJobs } from './helpers.js';
import { buildApp } from '../src/http/app.js';
import { createAdmin } from '../src/services/admin.js';
import { mockCallback } from '../src/adapters/payments/mock.js';
import { many, one } from '../src/db/pool.js';

const ctx = makeCtx();
let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(ctx); });
afterAll(async () => { await app.close(); await ctx.db.end(); });
beforeEach(async () => { await reset(ctx); await addStock(ctx, 'netflix', 50, 6); });

const SECRET = 'test-callback-secret-0123456789';
const call = (method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: method as any, url, payload: payload as any, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

async function login(phone = '0712345482', name = 'Hana Tesfaye') {
  const r = await call('POST', '/v1/auth/mpesa', undefined, { authCode: `mock:${phone}:${name}` });
  expect(r.statusCode).toBe(200);
  return r.json().token as string;
}

/** M-Pesa confirms the payment (the mock adapter's callback, posted to our webhook). */
async function confirm(pay: { checkoutRequestId: string; amountMinor: number }) {
  const r = await call('POST', `/v1/webhooks/mpesa/${SECRET}`, undefined, mockCallback(pay.checkoutRequestId, { ok: true, amountMinor: pay.amountMinor }));
  expect(r.statusCode).toBe(200);
}

async function adminToken(role: 'owner' | 'admin' | 'support' | 'viewer' = 'owner') {
  const email = `${role}-${Math.random().toString(36).slice(2)}@ecards.test`;
  await createAdmin(ctx.db, email, role, 'a-long-password', role);
  const r = await call('POST', '/v1/admin/login', undefined, { email, password: 'a-long-password' });
  expect(r.statusCode).toBe(200);
  return r.json().token as string;
}

describe('customer API', () => {
  it('health and catalog are public', async () => {
    expect((await call('GET', '/health')).json()).toMatchObject({ ok: true });
    const c = await call('GET', '/v1/catalog');
    expect(c.statusCode).toBe(200);
    expect(c.json().brands.length).toBe(11);
  });

  it('everything else needs a valid session', async () => {
    expect((await call('GET', '/v1/orders')).statusCode).toBe(401);
    expect((await call('GET', '/v1/orders', 'bogus')).statusCode).toBe(401);
    const t = await login();
    expect((await call('GET', '/v1/orders', t)).statusCode).toBe(200);
    await call('POST', '/v1/auth/logout', t);
    expect((await call('GET', '/v1/orders', t)).statusCode).toBe(401);
  });

  it('bad login codes are refused', async () => {
    const r = await call('POST', '/v1/auth/mpesa', undefined, { authCode: 'mock:12345:x' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('login_failed');
  });

  it('full purchase: order → pay → M-Pesa callback → codes', async () => {
    const t = await login();
    const created = await call('POST', '/v1/orders', t, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 2 }], deliverBy: 'sms' }, { 'idempotency-key': 'abc' });
    expect(created.statusCode).toBe(201);
    const order = created.json();
    const pay = await call('POST', `/v1/orders/${order.id}/pay`, t);
    expect(pay.statusCode).toBe(200);
    const cb = await call('POST', `/v1/webhooks/mpesa/${SECRET}`, undefined, mockCallback(pay.json().checkoutRequestId, { amountMinor: order.totalMinor }));
    expect(cb.statusCode).toBe(200);
    expect(cb.json()).toMatchObject({ ResultCode: 0 });
    await drainJobs(ctx);
    const got = (await call('GET', `/v1/orders/${order.reference}`, t)).json();
    expect(got.status).toBe('completed');
    expect(got.items[0].codes).toHaveLength(2);
    // mark a code as used
    const used = await call('POST', `/v1/codes/${got.items[0].codes[0].id}/used`, t, { used: true });
    expect(used.statusCode).toBe(200);
    expect((await call('GET', `/v1/orders/${order.id}`, t)).json().items[0].codes[0].usedAt).toBeTruthy();
  });

  it('webhook with the wrong secret is rejected and not processed', async () => {
    const r = await call('POST', '/v1/webhooks/mpesa/guess', undefined, mockCallback('ws_x'));
    expect(r.statusCode).toBe(404);
    expect((await one(ctx.db, `SELECT count(*)::int n FROM webhook_events`)).n).toBe(0);
  });

  it('there is no payment simulator', async () => {
    expect((await call('POST', '/v1/dev/mpesa/simulate', undefined, { paymentId: '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(404);
  });

  it('staff record an M-Pesa payment by its receipt: right amount only, once, admins only, audited', async () => {
    const t = await login();
    const order = (await call('POST', '/v1/orders', t, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }] })).json();
    await call('POST', `/v1/orders/${order.id}/pay`, t);
    const support = await adminToken('support'), admin = await adminToken('admin');
    const unpaid = (await call('GET', '/v1/admin/orders/unpaid', support)).json().orders;
    expect(unpaid[0]).toMatchObject({ reference: order.reference, status: 'pending_payment', last_payment: { status: 'pending' } });
    const rec = (tok: string, body: object) => call('POST', `/v1/admin/orders/${order.id}/record-payment`, tok, body);
    expect((await rec(support, { receipt: 'QAYGDMWP8S', amountMinor: order.totalMinor })).statusCode).toBe(403);
    expect((await rec(admin, { receipt: 'QAYGDMWP8S', amountMinor: order.totalMinor - 100 })).json().error).toBe('amount_mismatch');
    expect((await rec(admin, { receipt: 'x', amountMinor: order.totalMinor })).json().error).toBe('receipt_invalid');
    expect((await rec(admin, { receipt: 'qaygdmwp8s', amountMinor: order.totalMinor })).json()).toEqual({ ok: true, result: 'paid' });
    await drainJobs(ctx);
    expect((await call('GET', `/v1/orders/${order.id}`, t)).json()).toMatchObject({ status: 'completed', payment: { receipt: 'QAYGDMWP8S' } });
    expect((await rec(admin, { receipt: 'QAYGDMWP8S', amountMinor: order.totalMinor })).json().error).toBe('order_not_payable');
    // the same receipt cannot pay a second order
    const o2 = (await call('POST', '/v1/orders', t, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }] })).json();
    expect((await call('POST', `/v1/admin/orders/${o2.id}/record-payment`, admin, { receipt: 'QAYGDMWP8S', amountMinor: o2.totalMinor })).json().error).toBe('receipt_used');
    expect((await many(ctx.db, `SELECT action FROM audit_log`)).map(a => a.action)).toContain('payment.recorded_by_staff');
  });

  it('validates input with clear errors', async () => {
    const t = await login();
    const r = await call('POST', '/v1/orders', t, { items: [{ brandId: 'netflix', quantity: 0 }] });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_request');
    const r2 = await call('POST', '/v1/orders', t, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }], deliverBy: 'email', deliverTo: 'bad' });
    expect(r2.json().error).toBe('emailInvalid');
  });

  it('profile, wishlist and support', async () => {
    const t = await login();
    const me = await call('PATCH', '/v1/me', t, { deliverBy: 'email', email: 'hana@example.com', lang: 'am' });
    expect(me.json()).toMatchObject({ lang: 'am', delivery: { by: 'email', email: 'hana@example.com' } });

    const pid = (await call('GET', '/v1/catalog')).json().brands.find((b: any) => b.id === 'xbox').products[0].id;
    expect((await call('PUT', `/v1/wishlist/${pid}`, t)).statusCode).toBe(200);
    expect((await call('PUT', `/v1/wishlist/${pid}`, t)).statusCode).toBe(200);   // idempotent
    const wl = (await call('GET', '/v1/wishlist', t)).json().items;
    expect(wl).toHaveLength(1);
    expect(wl[0]).toMatchObject({ id: pid, wasOutOfStock: true });

    const tk = await call('POST', '/v1/support/tickets', t, { topic: 'payment', text: 'I paid but see nothing' });
    expect(tk.statusCode).toBe(201);
    expect(tk.json().reference).toMatch(/^T\d{6}$/);
    const staff = await adminToken('support');
    const list = (await call('GET', '/v1/admin/tickets?status=open', staff)).json().tickets;
    expect(list).toHaveLength(1);
    expect((await call('POST', `/v1/admin/tickets/${list[0].id}/reply`, staff, { text: 'Your codes are in Orders.' })).statusCode).toBe(200);
    const mine = (await call('GET', '/v1/support/tickets', t)).json().tickets;
    expect(mine[0]).toMatchObject({ status: 'answered', unread: true });
    expect(mine[0].messages.map((m: any) => m.from)).toEqual(['customer', 'support']);
    await call('POST', `/v1/support/tickets/${mine[0].id}/seen`, t);
    expect((await call('GET', '/v1/support/tickets', t)).json().tickets[0].unread).toBe(false);
  });
});

describe('admin API', () => {
  it('wrong password → 401; five in a row lock the account', async () => {
    await createAdmin(ctx.db, 'lock@ecards.test', 'L', 'a-long-password', 'admin');
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/v1/admin/login', undefined, { email: 'lock@ecards.test', password: 'nope' })).statusCode).toBe(401);
    }
    const r = await call('POST', '/v1/admin/login', undefined, { email: 'lock@ecards.test', password: 'a-long-password' });
    expect(r.statusCode).toBe(429);
  });

  it('customer tokens do not open the admin API', async () => {
    const t = await login();
    expect((await call('GET', '/v1/admin/dashboard', t)).statusCode).toBe(401);
  });

  it('roles: viewers read, admins change settings, owners manage providers', async () => {
    const viewer = await adminToken('viewer'), admin = await adminToken('admin'), owner = await adminToken('owner');
    expect((await call('GET', '/v1/admin/dashboard', viewer)).statusCode).toBe(200);
    expect((await call('PATCH', '/v1/admin/settings', viewer, { usdEtbRate: 280 })).statusCode).toBe(403);
    expect((await call('PATCH', '/v1/admin/settings', admin, { usdEtbRate: 280 })).statusCode).toBe(200);
    const nf50 = (await call('GET', '/v1/catalog')).json().brands.find((b: any) => b.id === 'netflix').products[0];
    expect(nf50.priceMinor).toBe(50 * 280 * 100);
    expect((await call('PUT', '/v1/admin/providers/wupex', admin, { adapter: 'wupex' })).statusCode).toBe(403);
    expect((await call('PUT', '/v1/admin/providers/wupex', owner, { name: 'Wupex', adapter: 'wupex' })).statusCode).toBe(200);
    expect((await call('POST', '/v1/admin/stock/' + nf50.id + '/codes', viewer, { codes: ['AAAA-BBBB-CCCC'] })).statusCode).toBe(403);
  });

  it('settings changes are validated and audited', async () => {
    const admin = await adminToken('admin');
    expect((await call('PATCH', '/v1/admin/settings', admin, { vatRate: 1.2 })).statusCode).toBe(400);
    await call('PATCH', '/v1/admin/settings', admin, { usdEtbRate: 300 });
    const log = (await call('GET', '/v1/admin/audit', admin)).json().entries;
    expect(log.find((e: any) => e.action === 'settings.update').details.after.rate).toBe(300);
  });

  it('stock upload fills waiting pre-orders', async () => {
    const t = await login();
    const owner = await adminToken('owner');
    const order = (await call('POST', '/v1/orders', t, { items: [{ brandId: 'cod', faceValueUsd: 200, quantity: 1 }] })).json();
    const pay = (await call('POST', `/v1/orders/${order.id}/pay`, t)).json();
    await confirm(pay);
    await drainJobs(ctx);
    expect((await call('GET', `/v1/orders/${order.id}`, t)).json().status).toBe('awaiting_stock');
    const up = await call('POST', `/v1/admin/stock/${order.items[0].productId}/codes`, owner, { codes: ['COD1-2222-3333', { code: 'COD2-4444-5555', pin: '1234' }] });
    expect(up.json()).toMatchObject({ added: 2, queuedOrders: 1 });
    await drainJobs(ctx);
    expect((await call('GET', `/v1/orders/${order.id}`, t)).json().status).toBe('completed');
    const stock = (await call('GET', '/v1/admin/stock', owner)).json().products.find((p: any) => p.id === order.items[0].productId);
    expect(stock).toMatchObject({ codes_available: 1, codes_sold: 1, preorders_owed: 0 });
  });

  it('order codes are masked; revealing them needs admin and is audited', async () => {
    const t = await login();
    const order = (await call('POST', '/v1/orders', t, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }] })).json();
    const pay = (await call('POST', `/v1/orders/${order.id}/pay`, t)).json();
    await confirm(pay);
    await drainJobs(ctx);
    const support = await adminToken('support'), admin = await adminToken('admin');
    const masked = (await call('GET', `/v1/admin/orders/${order.id}`, support)).json();
    expect(masked.items[0].codes[0].code).toMatch(/^••••/);
    expect((await call('GET', `/v1/admin/orders/${order.id}?reveal=1`, support)).statusCode).toBe(403);
    const open = (await call('GET', `/v1/admin/orders/${order.id}?reveal=1`, admin)).json();
    expect(open.items[0].codes[0].code).toMatch(/^TST-/);
    expect(open.payments[0].status).toBe('succeeded');
    const actions = (await many(ctx.db, `SELECT action FROM audit_log`)).map(a => a.action);
    expect(actions).toContain('order.reveal_codes');
    // search by phone and by reference
    expect((await call('GET', `/v1/admin/orders?q=${order.reference}`, support)).json().orders).toHaveLength(1);
    expect((await call('GET', `/v1/admin/orders?q=712345482`, support)).json().orders).toHaveLength(1);
  });

  it('brand pictures: stored on the server, served with their real type, admins only, no SVG', async () => {
    const admin = await adminToken('admin'), support = await adminToken('support');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const put = (tok: string, dataUrl: string, kind = 'logo') => call('PUT', `/v1/admin/brands/netflix/media/${kind}`, tok, { dataUrl });
    expect((await put(support, 'data:image/png;base64,' + png.toString('base64'))).statusCode).toBe(403);
    expect((await put(admin, 'data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"/>').toString('base64'))).json().error).toBe('image_type');
    expect((await put(admin, 'data:image/png;base64,' + Buffer.from('not a png').toString('base64'))).json().error).toBe('image_type');
    const ok = (await put(admin, 'data:image/png;base64,' + png.toString('base64'))).json();
    expect(ok.url).toMatch(/^\/media\/brands\/netflix\/logo\?v=/);
    const b = (await call('GET', '/v1/catalog')).json().brands.find((x: any) => x.id === 'netflix');
    expect(b.logoUrl).toBe(ok.url);
    const img = await call('GET', ok.url);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.rawPayload.equals(png)).toBe(true);
    expect((await call('GET', '/media/brands/netflix/card')).statusCode).toBe(404);
    expect((await call('GET', '/media/brands/..%2f/logo')).statusCode).toBe(404);
    expect((await call('DELETE', '/v1/admin/brands/netflix/media/logo', admin)).statusCode).toBe(200);
    expect((await call('GET', '/v1/catalog')).json().brands.find((x: any) => x.id === 'netflix').logoUrl).toBeNull();
    expect((await call('GET', ok.url)).statusCode).toBe(404);
  });

  it('brands: create a new one with values, it shows in the catalog', async () => {
    const admin = await adminToken('admin');
    const r = await call('PUT', '/v1/admin/brands/roblox', admin, {
      name: 'Roblox', mark: 'ROBLOX', category: 'gaming', color1: '#111111', color2: '#222222', ink: '#ffffff', valuesUsd: [25, 50]
    });
    expect(r.statusCode).toBe(200);
    const b = (await call('GET', '/v1/catalog')).json().brands.find((x: any) => x.id === 'roblox');
    expect(b.products.map((p: any) => p.faceValueUsd)).toEqual([25, 50]);
    expect((await call('PUT', '/v1/admin/brands/Bad Id', admin, { name: 'x' })).statusCode).toBe(400);
  });

  it('provider sync and product mapping', async () => {
    const owner = await adminToken('owner');
    await call('PUT', '/v1/admin/providers/mock', owner, { name: 'Mock', adapter: 'mock', isActive: true });
    const s = (await call('POST', '/v1/admin/providers/mock/sync', owner)).json();
    expect(s).toMatchObject({ ok: true, products: 40 });
    const pid = (await call('GET', '/v1/catalog')).json().brands.find((b: any) => b.id === 'apple').products[0].id;
    expect((await call('PUT', `/v1/admin/products/${pid}/sources/mock`, owner, { externalProductId: 'apple-50', unitCostCents: 4900 })).statusCode).toBe(200);
    const apple50 = (await call('GET', '/v1/catalog')).json().brands.find((b: any) => b.id === 'apple').products[0];
    expect(apple50.availability).toBe('in_stock');
    const providers = (await call('GET', '/v1/admin/providers', owner)).json().providers;
    expect(providers[0]).toMatchObject({ id: 'mock', status: 'ok', products_mapped: 1 });
    const cat = (await call('GET', '/v1/admin/providers/mock/products', owner)).json().products;
    expect(cat.find((x: any) => x.external_id === 'apple-50').linked).toEqual([{ productId: pid, brandId: 'apple', faceValueUsd: 50, unitCostCents: 4900 }]);
    expect((await call('DELETE', `/v1/admin/products/${pid}/sources/mock`, owner)).statusCode).toBe(200);
    expect((await call('GET', '/v1/admin/providers/mock/products', owner)).json().products.find((x: any) => x.external_id === 'apple-50').linked).toEqual([]);
    const auto = (await call('POST', '/v1/admin/providers/mock/automap', owner, { apply: true, addValues: true })).json();
    expect(auto.saved).toBeGreaterThan(0);
    expect(auto.addedValues).toEqual([]);

    // a provider whose adapter is not configured on this server reports an error instead of crashing
    await call('PUT', '/v1/admin/providers/wupex', owner, { adapter: 'wupex' });
    const w = await call('POST', '/v1/admin/providers/wupex/sync', owner);
    expect(w.statusCode).toBe(400);
    expect(w.json().error).toBe('adapter_not_configured');
  });

  it('panel endpoints: full order list, masked codes, ticket status', async () => {
    const t = await login();
    const order = (await call('POST', '/v1/orders', t, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 2 }] })).json();
    const pay = (await call('POST', `/v1/orders/${order.id}/pay`, t)).json();
    await confirm(pay);
    await drainJobs(ctx);
    const mine = (await call('GET', '/v1/orders?full=1', t)).json().orders;
    expect(mine[0].items[0].codes).toHaveLength(2);
    expect(mine[0].items[0].codes[0].code).toMatch(/^TST-/);
    const staff = await adminToken('support');
    const panel = (await call('GET', '/v1/admin/orders?full=1', staff)).json().orders;
    expect(panel[0]).toMatchObject({ reference: order.reference, msisdn: '+251712345482' });
    expect(panel[0].items[0].codes.every((c: string) => c.startsWith('••••'))).toBe(true);
    const tk = (await call('POST', '/v1/support/tickets', t, { topic: 'other', text: 'hello there' })).json();
    expect((await call('POST', `/v1/admin/tickets/${tk.id}/status`, staff, { status: 'closed' })).statusCode).toBe(200);
    expect((await call('GET', '/v1/support/tickets', t)).json().tickets[0].status).toBe('closed');
    const viewer = await adminToken('viewer');
    expect((await call('POST', `/v1/admin/tickets/${tk.id}/status`, viewer, { status: 'open' })).statusCode).toBe(403);
  });

  it('dashboard counts', async () => {
    const owner = await adminToken('owner');
    const d = (await call('GET', '/v1/admin/dashboard', owner)).json();
    expect(d).toMatchObject({ orders_today: 0, tickets_open: 0, jobs_dead: 0 });
  });
});
