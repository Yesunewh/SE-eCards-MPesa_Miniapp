/** What the backend needs from M-Pesa: who the user is, take a payment, and hear back about it. */

export interface MpesaUser {
  userId: string;       // stable M-Pesa id for this user in our mini app
  msisdn: string;       // +2517XXXXXXXX
  name: string;
}

export interface InitiateInput {
  amountMinor: number;  // santim; always a whole number of Birr (see priceMinor)
  msisdn: string;
  reference: string;    // our order reference, e.g. EC12345678
  description: string;
  callbackUrl: string;
}

export interface InitiateResult {
  merchantRequestId?: string;
  checkoutRequestId: string;
  raw: unknown;         // stored on the payment row (no secrets)
}

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
  readonly name: 'mock' | 'safaricom';
  /** Mini app login: exchange the auth code from the M-Pesa super app for the user's identity. */
  exchangeAuthCode(authCode: string): Promise<MpesaUser>;
  /** Ask M-Pesa to charge the customer (they approve with their PIN). Throws if M-Pesa refuses the request. */
  initiate(input: InitiateInput): Promise<InitiateResult>;
  /** Turn a callback body into an outcome, or null if it is not a payment result we understand. */
  parseCallback(body: unknown): PaymentOutcome | null;
  /** Ask M-Pesa for the result when the callback is late. null = still pending. */
  query(checkoutRequestId: string): Promise<PaymentOutcome | null>;
}
