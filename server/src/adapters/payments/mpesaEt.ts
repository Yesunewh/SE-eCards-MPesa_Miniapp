/**
 * M-Pesa Ethiopia H5 mini app ("Pay with M-PESA", developer.safaricom.et → Mini App → H5 Mini-app).
 *
 *   App      my.call('payWithMpesa', { businessID, billReference, amount: '150.0', currency: 'ETB', reason })
 *            → M-Pesa shows its confirmation; returns { transactionId } or { error, errorMessage } (201 = cancelled)
 *   Server   C2B Validation   (optional) M-Pesa asks us before taking the money: we check the bill reference and amount
 *            C2B Confirmation the money moved: { TransID, TransAmount, BillRefNumber, MSISDN, BusinessShortCode, … }
 *            Both URLs are registered once with POST /v1/c2b-register-url/register?apikey=<consumer key>.
 *
 * Login does not go through this adapter: the app reads the user with my.call('userScopes') (see customers.ts).
 * The billReference is our order reference (attempt 2+ get a suffix, e.g. EC12345678R2) so every
 * confirmation maps to exactly one payment attempt.
 */
import type { InitiateInput, InitiateResult, MpesaUser, PaymentOutcome, PaymentsAdapter } from './types.js';
import { normMsisdn } from '../../lib/util.js';

export interface MpesaEtConfig {
  shortcode: string;              // our business number (businessID)
  baseUrl: string;                // https://apisandbox.safaricom.et or https://api.safaricom.et
  consumerKey: string;
  consumerSecret: string;
  currency?: string;
}

export const billReferenceFor = (reference: string, attempt = 1) => attempt > 1 ? `${reference}R${attempt}` : reference;
/** whole Birr with one decimal, as in the docs ('150.0') */
export const birrString = (minor: number) => (minor / 100).toFixed(2).replace(/0$/, '');

export class MpesaEtPayments implements PaymentsAdapter {
  readonly name = 'mpesa_et' as const;
  constructor(private readonly cfg: MpesaEtConfig) {}

  async exchangeAuthCode(): Promise<MpesaUser> {
    throw new Error('M-Pesa Ethiopia mini apps log in with userScopes, not an auth code');
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    if (!this.cfg.shortcode) throw new Error('MPESA_SHORTCODE (business number) is not set');
    const billReference = billReferenceFor(input.reference, input.attempt);
    const clientAction = {
      type: 'payWithMpesa' as const, businessID: this.cfg.shortcode, billReference,
      amount: birrString(input.amountMinor), currency: this.cfg.currency ?? 'ETB', reason: input.description.slice(0, 40)
    };
    return { checkoutRequestId: billReference, raw: { clientAction }, clientAction };
  }

  /** C2B Confirmation → payment outcome. Validation requests are handled separately (handleC2bValidation). */
  parseCallback(body: unknown): PaymentOutcome | null {
    const b = body as any;
    if (!b || typeof b.BillRefNumber !== 'string' || !b.TransID) return null;
    if (b.RequestType && b.RequestType !== 'Confirmation') return null;
    if (this.cfg.shortcode && b.BusinessShortCode && String(b.BusinessShortCode) !== String(this.cfg.shortcode)) return null;
    return {
      checkoutRequestId: b.BillRefNumber.trim(),
      status: 'succeeded', resultCode: '0', resultDesc: `C2B ${b.TransactionType ?? ''}`.trim(),
      receiptNumber: String(b.TransID),
      amountMinor: Math.round(Number(b.TransAmount) * 100),
      msisdn: normMsisdn(b.MSISDN) ?? undefined
    };
  }

  /** No server-side status query for this flow yet: the confirmation callback is the answer. */
  async query(): Promise<PaymentOutcome | null> { return null; }

  /** Registers our C2B URLs (official SDK: /v1/c2b-register-url/register?apikey=<consumer key>, no token). */
  async registerUrls(confirmationUrl: string, validationUrl: string) {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/v1/c2b-register-url/register?apikey=${encodeURIComponent(this.cfg.consumerKey)}`;
    const body = { ShortCode: this.cfg.shortcode, ResponseType: 'Completed', CommandID: 'RegisterURL', ConfirmationURL: confirmationUrl, ValidationURL: validationUrl };
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    return { http: res.status, body: text, sent: body };
  }
}
