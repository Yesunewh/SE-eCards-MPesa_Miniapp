/**
 * Safaricom Ethiopia M-Pesa adapter (STK push / "M-Pesa Express").
 *
 * Request and callback shapes follow Safaricom's Daraja-style API, which M-Pesa Ethiopia exposes at
 * apisandbox.safaricom.et / api.safaricom.et. VERIFY every path and field against the docs you receive
 * with your mini app onboarding before going live:
 *   - OAuth:      GET  /v1/token/generate?grant_type=client_credentials   (Basic consumerKey:consumerSecret)
 *   - STK push:   POST /mpesa/stkpush/v3/processrequest
 *   - STK query:  POST /mpesa/stkpushquery/v1/query
 *   - Mini app login (exchangeAuthCode): endpoint is given with the mini app SDK, not implemented yet.
 */
import type { InitiateInput, InitiateResult, MpesaUser, PaymentOutcome, PaymentsAdapter } from './types.js';
import { parseStkCallback } from './mock.js';

export interface SafaricomConfig {
  baseUrl: string; consumerKey: string; consumerSecret: string; shortcode: string; passkey: string;
}

export class SafaricomPayments implements PaymentsAdapter {
  readonly name = 'safaricom' as const;
  private token: { value: string; until: number } | null = null;

  constructor(private readonly cfg: SafaricomConfig) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.consumerKey}:${this.cfg.consumerSecret}`).toString('base64');
    const res = await fetch(`${this.cfg.baseUrl}/v1/token/generate?grant_type=client_credentials`, {
      headers: { authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) throw new Error(`M-Pesa token request failed: HTTP ${res.status}`);
    const j = await res.json() as { access_token: string; expires_in?: string | number };
    this.token = { value: j.access_token, until: Date.now() + Number(j.expires_in ?? 3599) * 1000 };
    return j.access_token;
  }

  /** yyyyMMddHHmmss in East Africa Time (UTC+3). */
  static timestamp(d = new Date()): string {
    const e = new Date(d.getTime() + 3 * 3600_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${e.getUTCFullYear()}${p(e.getUTCMonth() + 1)}${p(e.getUTCDate())}${p(e.getUTCHours())}${p(e.getUTCMinutes())}${p(e.getUTCSeconds())}`;
  }

  buildStkRequest(input: InitiateInput, ts = SafaricomPayments.timestamp()) {
    if (!input.msisdn) throw new Error('STK push needs the customer phone number');
    const msisdn = input.msisdn;
    const password = Buffer.from(this.cfg.shortcode + this.cfg.passkey + ts).toString('base64');
    return {
      MerchantRequestID: input.reference,
      BusinessShortCode: this.cfg.shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(input.amountMinor / 100),
      PartyA: msisdn.replace(/^\+/, ''),
      PartyB: this.cfg.shortcode,
      PhoneNumber: msisdn.replace(/^\+/, ''),
      CallBackURL: input.callbackUrl,
      AccountReference: input.reference,
      TransactionDesc: input.description.slice(0, 40)
    };
  }

  async exchangeAuthCode(_authCode: string): Promise<MpesaUser> {
    throw new Error('M-Pesa mini app login is not implemented yet: needs the endpoint from the mini app SDK docs');
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const body = this.buildStkRequest(input);
    const res = await fetch(`${this.cfg.baseUrl}/mpesa/stkpush/v3/processrequest`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000)
    });
    const j = await res.json().catch(() => ({})) as any;
    if (!res.ok || String(j.ResponseCode ?? '') !== '0' || !j.CheckoutRequestID) {
      throw new Error(`M-Pesa refused the payment request: ${j.errorMessage ?? j.ResponseDescription ?? `HTTP ${res.status}`}`);
    }
    const { Password: _omit, ...safe } = body;   // never store the password
    return { checkoutRequestId: j.CheckoutRequestID, merchantRequestId: j.MerchantRequestID, raw: { request: safe, response: j } };
  }

  parseCallback(body: unknown): PaymentOutcome | null {
    return parseStkCallback(body);
  }

  async query(checkoutRequestId: string): Promise<PaymentOutcome | null> {
    const ts = SafaricomPayments.timestamp();
    const res = await fetch(`${this.cfg.baseUrl}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: this.cfg.shortcode,
        Password: Buffer.from(this.cfg.shortcode + this.cfg.passkey + ts).toString('base64'),
        Timestamp: ts, CheckoutRequestID: checkoutRequestId
      }),
      signal: AbortSignal.timeout(20_000)
    });
    const j = await res.json().catch(() => ({})) as any;
    if (j.ResultCode === undefined || j.ResultCode === null) return null;   // still processing
    const code = String(j.ResultCode);
    return {
      checkoutRequestId, status: code === '0' ? 'succeeded' : code === '1032' ? 'cancelled' : code === '1037' ? 'timeout' : 'failed',
      resultCode: code, resultDesc: String(j.ResultDesc ?? '')
    };
  }
}
