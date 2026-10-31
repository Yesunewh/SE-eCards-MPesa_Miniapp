/**
 * Wupex adapter: PLACEHOLDER until the API documentation and credentials arrive.
 *
 * Everything else in the backend (stock, pre-orders, idempotency, retries, the API log, cost tracking)
 * already works through the GiftCardProvider interface and is tested with the mock provider.
 * To go live, fill in the four methods below from the Wupex docs:
 *
 *   getBalance()     → wallet balance endpoint
 *   listProducts()   → catalog endpoint, mapped to ProviderCatalogItem
 *   placeOrder()     → order endpoint. Send input.customIdentifier as Wupex's client/reference id so a retry
 *                      can never buy twice. Throw ProviderUnknownError on timeouts / 5xx / network errors.
 *   findOrder()      → look up an order by that reference (used to settle 'unknown' outcomes)
 *
 * Questions to ask Wupex when you get access:
 *   1. Auth scheme (API key header? HMAC signature? OAuth?) and sandbox vs live base URLs.
 *   2. Do they accept our own reference/idempotency key on orders, and can we query by it?
 *   3. Are codes returned synchronously in the order response, or fetched afterwards / via webhook?
 *   4. Wallet currency (USD?) and how cost/discount is reported per order.
 *   5. Product ids for Netflix, Steam, Xbox, PlayStation, Apple, Spotify, Google Play, PUBG, Razer Gold, Call of Duty
 *      in the USD values we sell (50/100/150/200), and which country/region each card works in.
 *   6. Rate limits, IP allow-listing (they may need our server's fixed IP), and webhook signing if any.
 */
import type { GiftCardProvider, PlaceOrderInput, PlaceOrderResult, ProviderCatalogItem } from './types.js';
import { ProviderUnknownError } from './types.js';

export interface WupexConfig { baseUrl: string; apiKey: string; apiSecret: string; timeoutMs?: number }

export class WupexProvider implements GiftCardProvider {
  readonly name = 'wupex';
  onCall?: GiftCardProvider['onCall'];

  constructor(private readonly cfg: WupexConfig) {}

  /** Shared HTTP helper: timing, API log, and the unknown-outcome rule. */
  protected async request<T>(method: string, path: string, body?: unknown, ref?: string): Promise<{ status: number; data: T }> {
    if (!this.cfg.baseUrl) throw new Error('WUPEX_BASE_URL is not set');
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(this.cfg.baseUrl.replace(/\/$/, '') + path, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          // TODO(wupex): replace with their real auth header(s) / signature
          authorization: `Bearer ${this.cfg.apiKey}`
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000)
      });
    } catch (e) {
      this.onCall?.({ method, path, ms: Date.now() - t0, ok: false, note: (e as Error).message, ref });
      throw new ProviderUnknownError(`network: ${(e as Error).message}`);
    }
    const data = (await res.json().catch(() => ({}))) as T;
    this.onCall?.({ method, path, status: res.status, ms: Date.now() - t0, ok: res.ok, ref });
    if (res.status >= 500) throw new ProviderUnknownError(`HTTP ${res.status}`);
    return { status: res.status, data };
  }

  async getBalance(): Promise<{ balanceCents: number; currency: string }> {
    throw new Error('Wupex adapter not implemented yet: waiting for API documentation (getBalance)');
  }

  async listProducts(): Promise<ProviderCatalogItem[]> {
    throw new Error('Wupex adapter not implemented yet: waiting for API documentation (listProducts)');
  }

  async placeOrder(_input: PlaceOrderInput): Promise<PlaceOrderResult> {
    throw new Error('Wupex adapter not implemented yet: waiting for API documentation (placeOrder)');
  }

  async findOrder(_customIdentifier: string): Promise<PlaceOrderResult | null> {
    throw new Error('Wupex adapter not implemented yet: waiting for API documentation (findOrder)');
  }
}
