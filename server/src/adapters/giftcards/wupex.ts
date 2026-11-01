/**
 * Wupex gift card API (https://wupex.com/api-doc-overview/).
 *
 *   sandbox  https://sandbox-service.wupex.com      live  https://service.wupex.com
 *   headers  x-api-key, Accept-Language: en-US, Content-Type: application/json
 *
 *   GET  /api/customer/balance                      → { data: { balance, credit, creditBalance }, status }
 *   POST /api/product/merchant/invited/list         { page, pageSize≤100 } → { pageInfo, data: [product], status }
 *   POST /api/order/pull-codes                      [{ merchant, sku, quantity }] → { data: { orderName, totalAmount, serials[] }, status }
 *   GET  /api/order/detail?orderName=…              → { data: { id, orderName, orderData[{ productCode, serials[] }] }, status }
 *   POST /api/order/list                            { page, pageSize, orderColumn, order } → { data: [{ id, orderName, orderDate, orderAmount }] }
 *   errors                                          { status: false, error: { code, message } }
 *
 * Wupex takes no reference of ours on an order, so a purchase whose answer is lost (timeout) cannot be looked
 * up by our id. To stay safe:
 *   1. purchases are serialized (one at a time per provider; fulfilment holds a lock), and none starts while an
 *      earlier one is unresolved;
 *   2. right before buying, prepareOrder() records the newest Wupex order id (the "marker");
 *   3. after a timeout, findOrder() looks for an order newer than the marker, not already claimed by another of
 *      our purchases, with the same SKU and quantity. Found → its codes are used. Not found after a few minutes →
 *      Wupex never got it, so fulfilment may buy again.
 */
import type { GiftCardProvider, LookupContext, PlaceOrderInput, PlaceOrderResult, ProviderCatalogItem, DeliveredCard } from './types.js';
import { ProviderUnknownError } from './types.js';

export interface WupexConfig {
  baseUrl: string;
  apiKey: string;
  merchant: string;            // the merchant code sent with every order line
  currency?: string;           // currency of prices and balance (not stated in the docs: confirm with Wupex)
  timeoutMs?: number;
  /** how long an order may take to appear in the order list before we conclude Wupex never got it */
  settleSecs?: number;
}

interface WupexSerial { sku?: string; productSku?: string; serialCode?: string; serialNumber?: string }

/** "$50" out of "NETFLIX-USA-50USD" or "Netflix 50 USD": the face value in cents, if there is one. */
export function faceValueCents(...texts: (string | undefined)[]): number | undefined {
  for (const t of texts) {
    const m = String(t ?? '').match(/(\d+(?:\.\d{1,2})?)\s*-?\s*USD\b/i) ?? String(t ?? '').match(/\$\s*(\d+(?:\.\d{1,2})?)/);
    if (m) return Math.round(Number(m[1]) * 100);
  }
  return undefined;
}

export class WupexProvider implements GiftCardProvider {
  readonly name = 'wupex';
  readonly serialize = true;
  onCall?: GiftCardProvider['onCall'];

  constructor(private readonly cfg: WupexConfig) {}

  private get currency() { return this.cfg.currency ?? 'USD'; }

  /** One HTTP call. Unknown outcomes (network, timeout, 408, 429, 5xx) throw ProviderUnknownError. */
  protected async request<T = any>(method: 'GET' | 'POST', path: string, body?: unknown, ref?: string): Promise<{ http: number; json: T }> {
    if (!this.cfg.baseUrl || !this.cfg.apiKey) throw new Error('Wupex is not configured (WUPEX_BASE_URL / WUPEX_API_KEY)');
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(this.cfg.baseUrl.replace(/\/+$/, '') + path, {
        method,
        headers: {
          'x-api-key': this.cfg.apiKey,
          'Accept-Language': 'en-US',
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000)
      });
    } catch (e) {
      this.onCall?.({ method, path: path.split('?')[0]!, ms: Date.now() - t0, ok: false, note: `network: ${(e as Error).message}`, ref });
      throw new ProviderUnknownError(`network: ${(e as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as any;
    const ok = res.ok && json?.status === true;
    this.onCall?.({
      method, path: path.split('?')[0]!, status: res.status, ms: Date.now() - t0, ok, ref,
      note: ok ? undefined : `${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`.trim().slice(0, 300) || undefined
    });
    if (res.status === 408 || res.status === 429 || res.status >= 500) throw new ProviderUnknownError(`HTTP ${res.status}`);
    return { http: res.status, json };
  }

  private fail(json: any, http: number): Error {
    return new Error(`Wupex ${http}: ${json?.error?.code ?? 'ERROR'} ${json?.error?.message ?? ''}`.trim());
  }

  async getBalance() {
    const { http, json } = await this.request('GET', '/api/customer/balance');
    if (json?.status !== true) throw this.fail(json, http);
    return { balanceCents: Math.round(Number(json.data?.balance ?? 0) * 100), currency: this.currency };
  }

  async listProducts(): Promise<ProviderCatalogItem[]> {
    const out: ProviderCatalogItem[] = [];
    for (let page = 1; page <= 50; page++) {
      const { http, json } = await this.request('POST', '/api/product/merchant/invited/list', { page, pageSize: 100 });
      if (json?.status !== true) throw this.fail(json, http);
      for (const p of (json.data ?? []) as any[]) {
        const sku = String(p.productCode ?? '');
        if (!sku) continue;
        const face = faceValueCents(sku, p.productName);
        const parts = sku.split('-');
        out.push({
          externalId: sku,
          name: String(p.productName ?? sku),
          brandName: p.productType ?? parts[0],
          country: parts.length >= 3 ? parts[1] : undefined,
          currency: this.currency,
          type: 'FIXED',
          denominationsCents: face ? [face] : [],
          discountPct: p.discountRate != null ? Number(p.discountRate) * 100 : undefined,
          priceCents: p.price != null ? Math.round(Number(p.price) * 100) : undefined,
          available: p.enabled !== false && (p.available == null || Number(p.available) > 0),
          raw: p
        });
      }
      const info = json.pageInfo ?? {};
      if (!info.totalPage || page >= Number(info.totalPage)) break;
    }
    return out;
  }

  /** The newest order id on the account, recorded before buying (see the header comment). */
  async prepareOrder(): Promise<Record<string, unknown>> {
    try {
      const recent = await this.recentOrders(5);
      const newest = recent.reduce((m, o) => (Number(o.id) > m ? Number(o.id) : m), 0);
      return { markerId: newest, preparedAt: new Date().toISOString() };
    } catch (e) {
      // nothing was bought yet: report it as a plain failure so fulfilment tries again later
      throw new Error(`could not read the Wupex order list before buying: ${(e as Error).message}`);
    }
  }

  private async recentOrders(pageSize: number): Promise<Array<{ id: number; orderName: string; orderDate?: string; orderAmount?: number }>> {
    const { http, json } = await this.request('POST', '/api/order/list', { page: 1, pageSize, orderColumn: 'orderDate', order: 'DESC' });
    if (json?.status !== true) throw this.fail(json, http);
    return (json.data ?? []) as any[];
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const { http, json } = await this.request('POST', '/api/order/pull-codes',
      [{ merchant: this.cfg.merchant, sku: input.externalProductId, quantity: input.quantity }], input.customIdentifier);

    if (json?.status === true && json.data?.orderName) {
      const cards = toCards(json.data.serials ?? []);
      const totalCostCents = json.data.totalAmount != null ? Math.round(Number(json.data.totalAmount) * 100) : undefined;
      if (!cards.length) return { status: 'processing', transactionId: String(json.data.orderName) };   // codes to fetch with findOrder
      return { status: 'succeeded', transactionId: String(json.data.orderName), totalCostCents, cards };
    }
    // 409 "conflicting request state or duplicate": we cannot be sure nothing was bought
    if (http === 409) throw new ProviderUnknownError(`HTTP 409 ${json?.error?.code ?? ''}`);
    const code = String(json?.error?.code ?? `HTTP_${http}`);
    return { status: 'failed', reason: `${code}: ${json?.error?.message ?? ''}`.trim(), retryable: code === 'INSUFFICIENT_STOCK' };
  }

  async findOrder(_customIdentifier: string, c: LookupContext): Promise<PlaceOrderResult | null> {
    // the order name is already known (Wupex answered without codes): just read that order
    const known = c.prepared?.knownTransactionId ? String(c.prepared.knownTransactionId) : '';
    if (known) {
      const d = await this.orderDetail(known);
      if (d && d.cards.length) return { status: 'succeeded', transactionId: d.orderName, totalCostCents: d.totalCostCents, cards: d.cards.map(({ sku: _s, ...card }) => card) };
      return { status: 'processing', transactionId: known };
    }
    const marker = Number(c.prepared?.markerId);
    if (!Number.isFinite(marker)) throw new Error('no marker recorded before this purchase: check the Wupex order list by hand');
    const recent = await this.recentOrders(30);
    const candidates = recent
      .filter(o => Number(o.id) > marker && !c.claimed.includes(String(o.orderName)))
      .sort((a, b) => Number(a.id) - Number(b.id));
    for (const o of candidates) {
      const d = await this.orderDetail(String(o.orderName));
      if (!d) continue;
      const mine = d.cards.filter(x => x.sku === c.externalProductId);
      const other = d.cards.length - mine.length;
      if (mine.length === c.quantity && other === 0) {
        return { status: 'succeeded', transactionId: d.orderName, totalCostCents: d.totalCostCents, cards: mine.map(({ sku: _s, ...card }) => card) };
      }
    }
    // not there (yet): give Wupex a few minutes before concluding it never got the order
    const age = (Date.now() - c.placedAt.getTime()) / 1000;
    if (age < (this.cfg.settleSecs ?? 180)) return { status: 'processing' };
    return null;
  }

  async orderDetail(orderName: string): Promise<{ orderName: string; totalCostCents?: number; cards: Array<DeliveredCard & { sku?: string }> } | null> {
    const { http, json } = await this.request('GET', `/api/order/detail?orderName=${encodeURIComponent(orderName)}`, undefined, orderName);
    if (http === 404 || json?.status !== true) return null;
    const serials: WupexSerial[] = (json.data?.orderData ?? []).flatMap((row: any) =>
      (row.serials ?? []).map((s: any) => ({ ...s, sku: s.productSku ?? row.productCode })));
    return {
      orderName: String(json.data?.orderName ?? orderName),
      totalCostCents: json.data?.orderAmount != null ? Math.round(Number(json.data.orderAmount) * 100) : undefined,
      cards: serials.filter(s => s.serialCode).map(s => ({ sku: s.sku, code: String(s.serialCode), serial: s.serialNumber ? String(s.serialNumber) : undefined }))
    };
  }
}

function toCards(serials: WupexSerial[]): DeliveredCard[] {
  return serials.filter(s => s.serialCode).map(s => ({ code: String(s.serialCode), serial: s.serialNumber ? String(s.serialNumber) : undefined }));
}
