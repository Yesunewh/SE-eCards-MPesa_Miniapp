/** What the backend needs from M-Pesa: who the user is, take a payment, and hear back about it. */

export interface MpesaUser {
  userId: string;       // stable M-Pesa id for this user in our mini app
  msisdn: string | null; // +2517XXXXXXXX, when M-Pesa shares it
  name: string;
}

export interface InitiateInput {
  paymentId: string;    // our payments.id: unique per attempt, used as the idempotency key where supported
  amountMinor: number;  // santim; always a whole number of Birr (see priceMinor)
  msisdn: string | null;
  orderCreatedAt?: Date;
  attempt?: number;     // 1 for the first payment attempt of this order, 2 for the next …
  reference: string;    // our order reference, e.g. EC12345678
  description: string;
  callbackUrl: string;
}

export interface InitiateResult {
  merchantRequestId?: string;
  checkoutRequestId: string;
  raw: unknown;         // stored on the payment row (no secrets)
  /** Something the app must do to let the customer pay, e.g. open the M-Pesa cashier with my.tradePay. */
  clientAction?: ClientAction;
  /** The wallet already gave a final answer in the reply. */
  immediate?: PaymentOutcome;
}

/** What the app must do so the customer can pay. */
export type ClientAction =
  | { type: 'tradePay'; paymentUrl: string }
  /** M-Pesa Ethiopia H5 mini app: my.call('payWithMpesa', …) */
  | { type: 'payWithMpesa'; businessID: string; billReference: string; amount: string; currency: string; reason: string };

export interface PaymentOutcome {
  checkoutRequestId: string;
  merchantRequestId?: string;
  status: 'succeeded' | 'failed' | 'cancelled' | 'timeout';
  resultCode: string;
  resultDesc: string;
  receiptNumber?: string;
  amountMinor?: number;
  msisdn?: string;
}

export interface PaymentsAdapter {
  readonly name: 'mock' | 'safaricom' | 'miniapp' | 'mpesa_et';
  /** Mini app login: exchange the auth code from the M-Pesa super app for the user's identity. */
  exchangeAuthCode(authCode: string): Promise<MpesaUser>;
  /** Ask M-Pesa to charge the customer (they approve with their PIN). Throws if M-Pesa refuses the request. */
  initiate(input: InitiateInput): Promise<InitiateResult>;
  /** Turn a callback body into an outcome, or null if it is not a payment result we understand. */
  parseCallback(body: unknown): PaymentOutcome | null;
  /** Ask M-Pesa for the result when the callback is late. null = still pending. */
  query(checkoutRequestId: string): Promise<PaymentOutcome | null>;
  /** Signed callbacks: true when the request really comes from the wallet. */
  verifyCallback?(rawBody: string, headers: Record<string, string | string[] | undefined>, path: string): boolean;
  /** The exact reply the wallet expects (signed when required). */
  callbackReply?(ok: boolean, path: string): { headers: Record<string, string>; body: string };
}
