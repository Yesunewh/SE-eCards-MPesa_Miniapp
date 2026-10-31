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
  raw?: unknown;
}

export interface DeliveredCard {
  code: string;
  pin?: string;
  serial?: string;
  expiresOn?: string;   // YYYY-MM-DD
}

export type PlaceOrderResult =
  /** Codes received. */
  | { status: 'succeeded'; transactionId: string; totalCostCents?: number; cards: DeliveredCard[] }
  /** Provider accepted but codes are not ready yet: poll findOrder later. */
  | { status: 'processing'; transactionId?: string }
  /** Definite failure: nothing was charged (out of stock, bad product, no balance…). */
  | { status: 'failed'; reason: string; retryable: boolean };

export interface PlaceOrderInput {
  externalProductId: string;
  quantity: number;
  unitFaceValueCents: number;
  /** Our idempotency key. Must be sent to the provider so a retry never buys twice. */
  customIdentifier: string;
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
  /** Look an order up by our customIdentifier. null = the provider never received it. */
  findOrder(customIdentifier: string): Promise<PlaceOrderResult | null>;
  /** Optional hook so every HTTP call lands in provider_api_calls. */
  onCall?: (c: ApiCallRecord) => void;
}

export class ProviderUnknownError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderUnknownError'; }
}
