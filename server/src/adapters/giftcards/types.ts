/**
 * What the backend needs from a gift card provider (Wupex, Reloadly, …).
 * Each provider gets one adapter file that maps its HTTP API onto this interface.
 */

export interface ProviderCatalogItem {
  externalId: string;
  name: string;
  brandName?: string;
  country?: string;
  currency: string;
  type: 'FIXED' | 'RANGE';
  denominationsCents?: number[];
  minCents?: number;
  maxCents?: number;
  discountPct?: number;
  feeCents?: number;
  available: boolean;
  /** the provider's own price per card, in its currency's cents (what we pay before discount) */
  priceCents?: number;
  raw?: unknown;
}

export interface DeliveredCard {
  code: string;
  pin?: string;
  serial?: string;
  expiresOn?: string;   // YYYY-MM-DD
}

export type PlaceOrderResult =
  /**
   * Codes received. `cards` is every code of this purchase so far (repeats are ignored when stored);
   * remaining > 0 means the provider is still buying the rest (a provider pre-order): ask findOrder again later.
   */
  | { status: 'succeeded'; transactionId: string; totalCostCents?: number; cards: DeliveredCard[]; remaining?: number }
  /** Provider accepted but codes are not ready yet: poll findOrder later. preorder: the provider is buying them (not an unknown outcome). */
  | { status: 'processing'; transactionId?: string; retryAfterSecs?: number; preorder?: boolean }
  /** Definite failure: nothing was charged (out of stock, bad product, no balance…). */
  | { status: 'failed'; reason: string; retryable: boolean };

export interface PlaceOrderInput {
  externalProductId: string;
  quantity: number;
  unitFaceValueCents: number;
  /** Our idempotency key. Must be sent to the provider so a retry never buys twice. */
  customIdentifier: string;
}

/** What fulfilment knows about a purchase when it has to look it up again. */
export interface LookupContext {
  externalProductId: string;
  quantity: number;
  /** when our provider_orders row was written, just before the call */
  placedAt: Date;
  /** whatever prepareOrder() returned before the purchase */
  prepared: Record<string, unknown>;
  /** provider order ids already matched to other purchases of ours: never return one of these */
  claimed: string[];
}

export interface ApiCallRecord {
  method: string; path: string; status?: number; ms: number; ok: boolean; note?: string; ref?: string;
}

export interface GiftCardProvider {
  readonly name: string;
  getBalance(): Promise<{ balanceCents: number; currency: string }>;
  listProducts(): Promise<ProviderCatalogItem[]>;
  /**
   * Buy cards. Must throw ProviderUnknownError (not return 'failed') when the outcome is unknown
   * (timeout, connection reset, 5xx): the order may have gone through, so we must look it up, never re-buy.
   */
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;
  /**
   * Look an order up after an unknown outcome. null = the provider never received it (safe to buy again);
   * 'processing' = too early to tell, ask again later.
   */
  findOrder(customIdentifier: string, context: LookupContext): Promise<PlaceOrderResult | null>;
  /** Called (and its result stored) right before placeOrder, e.g. to remember the newest provider order id. */
  prepareOrder?(input: PlaceOrderInput): Promise<Record<string, unknown>>;
  /** true: only one purchase at a time on this provider, and none while an earlier one is unresolved. */
  readonly serialize?: boolean;
  /** Optional hook so every HTTP call lands in provider_api_calls. */
  onCall?: (c: ApiCallRecord) => void;
}

export class ProviderUnknownError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderUnknownError'; }
}
