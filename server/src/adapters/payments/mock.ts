import { randomBytes } from 'node:crypto';
import type { InitiateInput, InitiateResult, MpesaUser, PaymentOutcome, PaymentsAdapter } from './types.js';
import { normMsisdn } from '../../lib/util.js';

/**
 * No real money. Login codes look like "mock:0712345678:Hana Tesfaye".
 * A payment stays pending until someone posts a callback built with mockCallback()
 * (the dev endpoint POST /v1/dev/mpesa/simulate does exactly that).
 */
export class MockPayments implements PaymentsAdapter {
  readonly name = 'mock' as const;
  readonly initiated = new Map<string, InitiateInput>();
  /** Outcomes returned by query(): set by tests to simulate a missed callback. */
  readonly settled = new Map<string, PaymentOutcome>();
  failNextInitiate = false;

  async exchangeAuthCode(authCode: string): Promise<MpesaUser> {
    const [kind, phone, ...rest] = authCode.split(':');
    const msisdn = normMsisdn(phone);
    if (kind !== 'mock' || !msisdn) throw new Error('invalid auth code');
    return { userId: `mock-${msisdn}`, msisdn, name: rest.join(':') || 'Demo Customer' };
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    if (this.failNextInitiate) { this.failNextInitiate = false; throw new Error('M-Pesa rejected the request (mock)'); }
    const checkoutRequestId = 'ws_CO_' + randomBytes(8).toString('hex');
    this.initiated.set(checkoutRequestId, input);
    return { checkoutRequestId, merchantRequestId: 'mr_' + randomBytes(4).toString('hex'), raw: { mock: true, reference: input.reference } };
  }

  parseCallback(body: unknown): PaymentOutcome | null {
    return parseStkCallback(body);
  }

  async query(checkoutRequestId: string): Promise<PaymentOutcome | null> {
    return this.settled.get(checkoutRequestId) ?? null;
  }
}

/** Builds the same callback body shape M-Pesa sends (Daraja-style stkCallback). */
export function mockCallback(checkoutRequestId: string, o: { ok?: boolean; amountMinor?: number; msisdn?: string; receipt?: string; resultCode?: number } = {}) {
  const ok = o.ok ?? true;
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: 'mr_mock',
        CheckoutRequestID: checkoutRequestId,
        ResultCode: o.resultCode ?? (ok ? 0 : 1032),
        ResultDesc: ok ? 'The service request is processed successfully.' : 'Request cancelled by user',
        ...(ok ? {
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: (o.amountMinor ?? 0) / 100 },
              { Name: 'MpesaReceiptNumber', Value: o.receipt ?? 'MCK' + randomBytes(4).toString('hex').toUpperCase() },
              { Name: 'TransactionDate', Value: 20261031120000 },
              { Name: 'PhoneNumber', Value: Number(String(o.msisdn ?? '+251700000000').replace(/\D/g, '')) }
            ]
          }
        } : {})
      }
    }
  };
}

/**
 * Parses a Daraja-style STK callback. Result codes: 0 success, 1032 cancelled by user,
 * 1037 timeout (no PIN entered), anything else failed.
 */
export function parseStkCallback(body: unknown): PaymentOutcome | null {
  const cb = (body as any)?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== 'string') return null;
  const code = String(cb.ResultCode);
  const items: Array<{ Name: string; Value: unknown }> = cb.CallbackMetadata?.Item ?? [];
  const get = (n: string) => items.find(i => i.Name === n)?.Value;
  const amount = get('Amount');
  const phone = get('PhoneNumber');
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    merchantRequestId: cb.MerchantRequestID,
    status: code === '0' ? 'succeeded' : code === '1032' ? 'cancelled' : code === '1037' ? 'timeout' : 'failed',
    resultCode: code,
    resultDesc: String(cb.ResultDesc ?? ''),
    receiptNumber: get('MpesaReceiptNumber') != null ? String(get('MpesaReceiptNumber')) : undefined,
    amountMinor: amount != null ? Math.round(Number(amount) * 100) : undefined,
    msisdn: phone != null ? normMsisdn(phone) ?? undefined : undefined
  };
}
