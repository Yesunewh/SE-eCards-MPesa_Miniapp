import { randomBytes, randomInt } from 'node:crypto';
import type { GiftCardProvider, PlaceOrderInput, PlaceOrderResult, ProviderCatalogItem } from './types.js';
import { ProviderUnknownError } from './types.js';

const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const group = () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('');
export const demoCode = () => `DEMO-${group()}-${group()}-${group()}`;

/**
 * Local stand-in for a provider: no network, generates DEMO codes.
 * Tests can script its behaviour with `next` (one-shot) to simulate failures and timeouts.
 */
export class MockProvider implements GiftCardProvider {
  readonly name = 'mock';
  balanceCents = 1_000_000;
  /** Orders the "provider" has received, keyed by customIdentifier. */
  readonly orders = new Map<string, PlaceOrderResult>();
  /** Queue of forced outcomes for the next placeOrder calls. */
  next: Array<'ok' | 'fail' | 'timeout_after_charge' | 'timeout_before_charge' | 'processing'> = [];
  calls = 0;
  onCall?: GiftCardProvider['onCall'];

  async getBalance() { return { balanceCents: this.balanceCents, currency: 'USD' }; }

  async listProducts(): Promise<ProviderCatalogItem[]> {
    const brands = ['netflix', 'steam', 'xbox', 'playstation', 'apple', 'spotify', 'googleplay', 'pubg', 'razer', 'cod'];
    return brands.flatMap(b => [50, 100, 150, 200].map(v => ({
      externalId: `${b}-${v}`, name: `${b} ${v} USD`, brandName: b, country: 'GLOBAL', currency: 'USD',
      type: 'FIXED' as const, denominationsCents: [v * 100], discountPct: 2, feeCents: 0, available: true
    })));
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    this.calls++;
    const t0 = Date.now();
    const mode = this.next.shift() ?? 'ok';
    const existing = this.orders.get(input.customIdentifier);
    if (existing) return existing;   // idempotent, like a real provider keyed on customIdentifier
    const cost = Math.round(input.unitFaceValueCents * 0.98) * input.quantity;
    const rec = (ok: boolean, status: number, note: string) =>
      this.onCall?.({ method: 'POST', path: '/orders', status, ms: Date.now() - t0, ok, note, ref: input.customIdentifier });

    if (mode === 'fail') { rec(false, 400, 'forced failure'); return { status: 'failed', reason: 'product unavailable', retryable: false }; }
    if (mode === 'timeout_before_charge') { rec(false, 504, 'timeout'); throw new ProviderUnknownError('timeout'); }
    if (this.balanceCents < cost) { rec(false, 400, 'insufficient balance'); return { status: 'failed', reason: 'insufficient balance', retryable: false }; }

    this.balanceCents -= cost;
    const done: PlaceOrderResult = {
      status: 'succeeded', transactionId: 'MCK' + randomBytes(6).toString('hex'), totalCostCents: cost,
      cards: Array.from({ length: input.quantity }, () => ({ code: demoCode() }))
    };
    this.orders.set(input.customIdentifier, done);
    if (mode === 'timeout_after_charge') { rec(false, 504, 'timeout after charge'); throw new ProviderUnknownError('timeout'); }
    if (mode === 'processing') { rec(true, 202, 'processing'); return { status: 'processing', transactionId: done.transactionId }; }
    rec(true, 200, `${input.quantity} card(s)`);
    return done;
  }

  async findOrder(customIdentifier: string) { return this.orders.get(customIdentifier) ?? null; }
}
