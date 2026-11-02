/**
 * Wupex gift card API (API reference v1.1, June 2026, checked against the sandbox on 2026-11-02).
 *
 *   sandbox  https://sandbox-service.wupex.com      live  set WUPEX_BASE_URL to the production service URL
 *            (the portal, sandbox-portal.wupex.com, is for browsers only: it refuses API calls)
 *   headers  x-api-key, Accept-Language: en, Content-Type: application/json
 *
 *   GET  /api/customer/balance                         → { data: { balance, credit, creditBalance }, status }
 *   POST /api/product/merchant/invited/list            { page, pageSize≤100 } → { pageInfo, data: [product], status }
 *   POST /api/order/pull-codes?referenceId=…&allowTakeAll=true   [{ merchant, sku, quantity }]
 *                                                      → { data: { orderName, totalAmount, preOrderNo, statusMessage }, status }
 *                                                        (no codes in this answer: they are read with order/detail)
 *   GET  /api/order/detail?referenceId=… | ?orderName=… → { data: { orderName, statusType, deliveredQuantity,
 *                                                        remainingQuantity, orderData[{ productCode, serials[] }] }, status }
 *   GET  /api/preorder/status                          → { data: { enabled }, status }
 *   errors                                             HTTP 200 { status: false, description: "[CODE] message" | "… | Insufficient Stock" }
 *
 * Safety:
 *   - every purchase carries referenceId = our provider_orders.custom_identifier. Wupex treats it as an
 *     idempotency key (a repeat answers ALREADY_COMPLETED for the same order, without charging again), and the
 *     order can be looked up by it, so a lost answer (timeout) is settled by asking for that referenceId.
 *   - Wupex pre-orders: when stock is short, Wupex delivers what it has and buys the rest from its suppliers
 *     (retrying every 10 minutes, up to 10 times), charging only for what it delivers. We keep reading the order
 *     until it is Completed or Failed, delivering codes to the customer as they arrive.
 */
import type { DeliveredCard, GiftCardProvider, LookupContext, PlaceOrderInput, PlaceOrderResult, ProviderCatalogItem } from './types.js';
import { ProviderUnknownError } from './types.js';

export interface WupexConfig {
  baseUrl: string;
  apiKey: string;
  merchant: string;            // merchant code (portal → avatar), sent with every order line
  currency?: string;           // currency of prices and balance (USD)
  timeoutMs?: number;
  /** how long an order may take to become visible by referenceId before we conclude Wupex never got it */
  settleSecs?: number;
  /** how often to read a Wupex pre-order that is still waiting for codes */
  preorderPollSecs?: number;
}

/** "$50" out of "NETFLIX-USA-50USD" or "Netflix 50 USD": the face value in cents, if there is one. */
export function faceValueCents(...texts: (string | undefined)[]): number | undefined {
  for (const t of texts) {
    const m = String(t ?? '').match(/(\d+(?:\.\d{1,2})?)\s*-?\s*USD\b/i) ?? String(t ?? '').match(/\$\s*(\d+(?:\.\d{1,2})?)/);
    if (m) return Math.round(Number(m[1]) * 100);
  }
  return undefined;
}

/** Wupex errors: { status:false, description:"[CODE] message" } or "RequestId:… | Insufficient Stock". */
export function wupexError(json: any, http: number): { code: string; message: string } {
  const d = String(json?.description ?? json?.error?.message ?? json?.message ?? '').trim();
  const bracket = d.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/);
  if (bracket) return { code: bracket[1]!, message: bracket[2]! };
  if (json?.error?.code) return { code: String(json.error.code), message: d };
  const tail = d.split('|').pop()!.trim();
  if (/insufficient stock/i.test(d) || json?.validateError?.product) return { code: 'INSUFFICIENT_STOCK', message: tail || d };
  if (/insufficient (balance|credit|fund)/i.test(d)) return { code: 'INSUFFICIENT_BALANCE', message: tail };
  if (/not found/i.test(d)) return { code: 'NOT_FOUND', message: tail };
  return { code: tail ? tail.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 40) : `HTTP_${http}`, message: d };
}

const RETRYABLE = new Set(['INSUFFICIENT_STOCK', 'INSUFFICIENT_BALANCE', 'PRODUCT_DISABLED', 'OUT_OF_STOCK']);
const cents = (v: unknown) => (v == null || v === '' ? undefined : Math.round(Number(v) * 100));

export class WupexProvider implements GiftCardProvider {
  readonly name = 'wupex';
  /** referenceId makes every purchase idempotent and findable, so purchases can run side by side */
  readonly serialize = false;
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
          'Accept-Language': 'en',
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
      note: ok ? (json?.description ? String(json.description).slice(0, 120) : undefined) : `${wupexError(json, res.status).code}: ${wupexError(json, res.status).message}`.slice(0, 300)
    });
    if (res.status === 408 || res.status === 429 || res.status >= 500) throw new ProviderUnknownError(`HTTP ${res.status}`);
    return { http: res.status, json };
  }

  private fail(json: any, http: number): Error {
    const e = wupexError(json, http);
    return new Error(`Wupex ${http}: ${e.code} ${e.message}`.trim());
  }

  /** What we can still spend: creditBalance (credit line + prepaid balance; balance itself goes negative on credit). */
  async getBalance() {
    const { http, json } = await this.request('GET', '/api/customer/balance');
    if (json?.status !== true) throw this.fail(json, http);
    const d = json.data ?? {};
    return { balanceCents: cents(d.creditBalance ?? d.balance) ?? 0, currency: String(d.currency ?? this.currency) };
  }

  async preorderEnabled(): Promise<boolean> {
    const { json } = await this.request('GET', '/api/preorder/status');
    return json?.status === true && json.data?.enabled === true;
  }

  async listProducts(): Promise<ProviderCatalogItem[]> {
    const out: ProviderCatalogItem[] = [];
    for (let page = 1; page <= 50; page++) {
      const { http, json } = await this.request('POST', '/api/product/merchant/invited/list', { page, pageSize: 100 });
      if (json?.status !== true) throw this.fail(json, http);
      for (const p of (json.data ?? []) as any[]) {
        const sku = String(p.productCode ?? '');
        if (!sku) continue;
        if (p.cardType && p.cardType !== 'voucher') continue;   // top-ups need the player's account id: not sold here
        // the SKU and name state the value; faceValue is only a fallback (the sandbox has "$15" with faceValue 16)
        const face = faceValueCents(sku, p.productName) ?? cents(p.faceValue);
        const parts = sku.split('-');
        const region = String(p.regionName ?? '').trim();
        out.push({
          externalId: sku,
          name: String(p.productName ?? sku),
          brandName: p.productType ?? parts[0],
          country: region ? region.toUpperCase() : parts.length >= 3 ? parts[1] : undefined,
          currency: this.currency,
          type: 'FIXED',
          denominationsCents: face ? [face] : [],
          // price is already what we pay (face value minus discountRate %): the discount is informational
          discountPct: p.discountRate != null ? Number(p.discountRate) : undefined,
          priceCents: cents(p.price),
          // out of stock but pre-order capable still counts: Wupex buys it from its suppliers
          available: p.enabled !== false && (p.available == null || Number(p.available) > 0 || p.preorder === true),
          raw: { productId: p.productId, available: p.available, preorder: p.preorder, faceValue: p.faceValue, regionName: p.regionName, imageUrl: p.imageUrl }
        });
      }
      const info = json.pageInfo ?? {};
      if (!info.totalPage || page >= Number(info.totalPage)) break;
    }
    return out;
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const ref = input.customIdentifier;
    const { http, json } = await this.request('POST',
      `/api/order/pull-codes?referenceId=${encodeURIComponent(ref)}&allowTakeAll=true`,
      [{ merchant: this.cfg.merchant, sku: input.externalProductId, quantity: input.quantity }], ref);

    if (json?.status === true && json.data?.orderName) {
      // accepted (or ALREADY_COMPLETED for this referenceId): the codes are read from the order itself
      const orderName = String(json.data.orderName);
      try {
        const d = await this.detail({ orderName }, ref);
        if (d) return d;
      } catch (e) {
        if (!(e instanceof ProviderUnknownError)) throw e;
      }
      return { status: 'processing', transactionId: orderName, retryAfterSecs: 10 };
    }
    if (json?.status === true) throw new ProviderUnknownError('Wupex accepted the order without an order number');
    const err = wupexError(json, http);
    // an answer that says the reference is in use / still running: the order may exist, look it up
    if (http === 409 || /REFERENCE|DUPLICATE|IN_PROGRESS|ALREADY/.test(err.code)) throw new ProviderUnknownError(`${err.code}: ${err.message}`);
    return { status: 'failed', reason: `${err.code}: ${err.message}`.slice(0, 300), retryable: RETRYABLE.has(err.code) };
  }

  /** After a lost answer, or while a Wupex pre-order is filling: read the order by our referenceId. */
  async findOrder(customIdentifier: string, c: LookupContext): Promise<PlaceOrderResult | null> {
    const d = await this.detail({ referenceId: customIdentifier }, customIdentifier);
    if (d) return d;
    // not visible (yet): give Wupex a little time before concluding it never got the order
    const age = (Date.now() - c.placedAt.getTime()) / 1000;
    if (age < (this.cfg.settleSecs ?? 90)) return { status: 'processing', retryAfterSecs: 20 };
    return null;
  }

  /** One order as a purchase result. null = no such order on our account. */
  async detail(q: { orderName?: string; referenceId?: string }, ref?: string): Promise<PlaceOrderResult | null> {
    const qs = q.orderName ? `orderName=${encodeURIComponent(q.orderName)}` : `referenceId=${encodeURIComponent(q.referenceId!)}`;
    const { http, json } = await this.request('GET', `/api/order/detail?${qs}`, undefined, ref);
    if (json?.status !== true || !json.data) {
      if (http === 404 || wupexError(json, http).code === 'NOT_FOUND') return null;
      throw this.fail(json, http);
    }
    const o = json.data;
    const cards: DeliveredCard[] = (o.orderData ?? []).flatMap((row: any) => (row.serials ?? []).map((s: any) => ({ ...s, _sku: s.productSku ?? row.productCode })))
      .filter((s: any) => s.serialCode)
      .map((s: any) => ({
        code: String(s.serialCode),
        pin: s.securityCode ? String(s.securityCode) : undefined,
        serial: s.serialNumber ? String(s.serialNumber) : undefined,
        expiresOn: s.expiry ? String(s.expiry).slice(0, 10) : undefined
      }));
    const orderName = String(o.orderName ?? q.orderName ?? '');
    const total = Number(o.totalQuantity ?? cards.length);
    const remaining = Math.max(0, Math.round(Number(o.remainingQuantity ?? Math.max(0, total - cards.length))));
    const type = String(o.statusType ?? o.status ?? '').toLowerCase();
    // charged only for what was delivered: the order amount pro rata
    const amount = cents(o.orderAmount);
    const totalCostCents = amount != null && total > 0 ? Math.round(amount * cards.length / total) : undefined;

    if (type.startsWith('fail') || type.startsWith('cancel')) {
      // Wupex gave up on the rest (and refunds it): keep what was delivered, the line falls back to other sources
      if (!cards.length) return { status: 'failed', reason: `Wupex order ${orderName} ${o.statusType ?? o.status}`, retryable: true };
      return { status: 'succeeded', transactionId: orderName, totalCostCents, cards, remaining: 0 };
    }
    const done = type.startsWith('complet') || type.startsWith('complat') || (remaining === 0 && cards.length > 0);
    if (!cards.length) return { status: 'processing', transactionId: orderName, retryAfterSecs: done ? 10 : (this.cfg.preorderPollSecs ?? 120), preorder: !done };
    return { status: 'succeeded', transactionId: orderName, totalCostCents, cards, remaining: done ? 0 : remaining };
  }
}
