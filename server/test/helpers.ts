import { loadConfig } from '../src/config.js';
import { createContext, type Ctx } from '../src/context.js';
import { seed } from '../src/db/seed.js';
import { MockPayments, mockCallback } from '../src/adapters/payments/mock.js';
import { MockProvider } from '../src/adapters/giftcards/mock.js';
import type { GiftCardProvider } from '../src/adapters/giftcards/types.js';
import type { PaymentsAdapter } from '../src/adapters/payments/types.js';
import { LogNotifier } from '../src/adapters/notify/index.js';
import { drainJobs } from '../src/worker.js';
import { loginWithMpesa, type Customer } from '../src/services/customers.js';
import { createOrder } from '../src/services/orders.js';
import { startPayment, handleMpesaCallback } from '../src/services/payments.js';
import { uploadCodes } from '../src/services/stock.js';
import { one } from '../src/db/pool.js';

export interface TestCtx extends Ctx { payments: MockPayments; mock: MockProvider; notes: LogNotifier }

export function makeCtx(opts: { providers?: Record<string, GiftCardProvider>; payments?: PaymentsAdapter } = {}): TestCtx {
  const mock = new MockProvider();
  const notes = new LogNotifier(true);
  const payments = opts.payments ?? new MockPayments();
  const ctx = createContext(loadConfig(), { payments, notifier: notes, providers: { mock, ...(opts.providers ?? {}) } }) as TestCtx;
  ctx.mock = mock; ctx.notes = notes;
  return ctx;
}

const TABLES = ['jobs', 'audit_log', 'notifications', 'support_messages', 'support_tickets', 'wishlist_items', 'provider_api_calls',
  'webhook_events', 'payments', 'gift_codes', 'provider_orders', 'order_items', 'orders', 'inventory_batches', 'product_sources',
  'provider_products', 'providers', 'home_row_items', 'home_popular_brands', 'home_banners', 'products', 'brands', 'app_settings',
  'admin_sessions', 'admin_users', 'customer_sessions', 'customers'];

/** Empty every table and re-seed the catalog. withProvider adds the mock provider mapped to every product. */
export async function reset(ctx: TestCtx, opts: { withProvider?: boolean } = {}) {
  await ctx.db.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  await seed(ctx.db, { mockProvider: !!opts.withProvider });
  ctx.mock.orders.clear(); ctx.mock.next = []; ctx.mock.calls = 0; ctx.mock.balanceCents = 1_000_000;
  if (ctx.payments instanceof MockPayments) { ctx.payments.initiated.clear(); ctx.payments.settled.clear(); ctx.payments.failNextInitiate = false; }
  ctx.notes.sent.length = 0;
}

let phoneSeq = 0;
export async function newCustomer(ctx: TestCtx, name = 'Test Customer'): Promise<{ token: string; customer: Customer }> {
  const phone = `07${String(10000000 + ++phoneSeq).slice(-8)}`;
  const r = await loginWithMpesa(ctx, `mock:${phone}:${name}`);
  const customer = await one<Customer>(ctx.db, 'SELECT * FROM customers WHERE id = $1', [r.customer.id]);
  return { token: r.token, customer };
}

export const productId = async (ctx: Ctx, brand: string, usd: number) =>
  (await one(ctx.db, 'SELECT id FROM products WHERE brand_id = $1 AND face_value_cents = $2', [brand, usd * 100])).id as string;

export async function addStock(ctx: Ctx, brand: string, usd: number, n: number, prefix = 'TST') {
  const pid = await productId(ctx, brand, usd);
  const codes = Array.from({ length: n }, (_, i) => ({ code: `${prefix}-${brand}-${usd}-${i}-${Math.random().toString(36).slice(2, 10)}` }));
  return uploadCodes(ctx, null, pid, codes);
}

/** Customer pays: M-Pesa request → approved (or declined) callback. */
export async function payFor(ctx: TestCtx, customer: Customer, orderId: string, ok = true) {
  const p = await startPayment(ctx, customer.id, orderId);
  const callback = mockCallback(p.checkoutRequestId!, { ok, amountMinor: p.amountMinor, msisdn: customer.msisdn ?? undefined });
  const result = await handleMpesaCallback(ctx, callback);
  return { payment: p, result, callback };
}

/** Order + pay + run the worker. Returns the order id. */
export async function buy(ctx: TestCtx, customer: Customer, items: { brandId: string; faceValueUsd: number; quantity: number }[]) {
  const o = await createOrder(ctx, customer, { items, deliverBy: 'sms' });
  await payFor(ctx, customer, o.id);
  await drainJobs(ctx);
  return o.id;
}

export { drainJobs };
