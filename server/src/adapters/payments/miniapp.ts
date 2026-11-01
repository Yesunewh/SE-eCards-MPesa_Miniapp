/**
 * M-Pesa mini program (Ant Group mini program platform used by M-Pesa Ethiopia).
 * Docs (shared M-Pesa template): https://portal.miniapps.ls.m-pesa.com/docs/miniprogram_mpesa-ls/mpdev/…
 *
 *   Login    app: my.getAuthCode({ scopes: ['auth_user'] })  →  server: POST /v2/authorizations/applyToken
 *            then the user's profile (name / phone) with the access token, if the wallet shares it
 *   Pay      server: POST /v2/payments/pay (CASHIER_PAYMENT) → redirectActionForm.redirectionUrl
 *            app: my.tradePay({ paymentUrl })  (9000 paid · 8000/6004 processing · 6001 cancelled · 4000 failed)
 *   Result   wallet → our paymentNotifyUrl: notifyPayment { paymentRequestId, paymentId, paymentResult, paymentAmount }
 *            we answer { result: { resultCode: 'SUCCESS', resultStatus: 'S' } }
 *   Check    server: POST /v2/payments/inquiryPayment { paymentRequestId } when the notification is late
 *
 * Every call is signed: content "POST /api/v2/payments/pay\n<Client-Id>.<Request-Time>.<body>",
 * SHA256withRSA with our private key, base64, URL-encoded, in the header
 *   Signature: algorithm=RSA256, keyVersion=1, signature=…
 * Replies and notifications from the wallet are checked the same way with the wallet's public key.
 *
 * Unconfirmed until onboarding (all configurable): API prefix (/api), amount format (santim vs Birr),
 * the user-profile endpoint and which scope reveals the phone number.
 */
import { createSign, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { InitiateInput, InitiateResult, MpesaUser, PaymentOutcome, PaymentsAdapter } from './types.js';
import { normMsisdn } from '../../lib/util.js';

export interface MiniAppConfig {
  gatewayUrl: string;             // https://<host assigned by the wallet>
  apiPrefix?: string;             // '/api'
  clientId: string;
  appId: string;
  authClientId: string;
  privateKeyPem: string;          // ours (PKCS#8 or PKCS#1 PEM)
  platformPublicKeyPem?: string;  // the wallet's
  keyVersion?: string;
  currency?: string;              // 'ETB'
  amountUnit?: 'minor' | 'major'; // value as santim ("1325000") or Birr ("13250")
  productCode?: string;           // 'CASHIER_PAYMENT'
  userInfoPath?: string;          // profile endpoint, relative to the gateway
  paymentTimeoutSecs?: number;
  timeoutMs?: number;
}

/** A PEM from config: the PEM itself (\n may be escaped), base64 of it, or a file path. */
export function readPem(v: string): string {
  const s = v.trim();
  if (!s) return '';
  if (s.startsWith('-----')) return s.replace(/\\n/g, '\n');
  if (s.startsWith('/')) return readFileSync(s, 'utf8');
  const decoded = Buffer.from(s, 'base64').toString('utf8');
  return decoded.startsWith('-----') ? decoded : s;
}

/** "algorithm=RSA256, keyVersion=1, signature=abc%3D" → "abc=" */
export function signatureValue(header: string | undefined): string | null {
  const m = String(header ?? '').match(/signature=([^,\s]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function signContent(method: string, path: string, clientId: string, time: string, body: string) {
  return `${method} ${path}\n${clientId}.${time}.${body}`;
}

export function rsaSign(content: string, privateKeyPem: string): string {
  return encodeURIComponent(createSign('RSA-SHA256').update(content).sign(privateKeyPem, 'base64'));
}

export function rsaVerify(content: string, signature: string, publicKeyPem: string): boolean {
  try {
    const sig = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');   // base64 or base64url
    return createVerify('RSA-SHA256').update(content).verify(publicKeyPem, sig);
  } catch { return false; }
}

const h1 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export class MiniAppPayments implements PaymentsAdapter {
  readonly name = 'miniapp' as const;
  private readonly key: string;
  private readonly platformKey: string;

  constructor(private readonly cfg: MiniAppConfig) {
    this.key = readPem(cfg.privateKeyPem);
    this.platformKey = readPem(cfg.platformPublicKeyPem ?? '');
  }

  /** true when the wallet's public key is configured: then every notification must carry a valid signature */
  get hasPlatformKey() { return !!this.platformKey; }

  private path(p: string) { return `${this.cfg.apiPrefix ?? '/api'}${p}`; }
  private toValue(minor: number) { return this.cfg.amountUnit === 'major' ? String(minor / 100) : String(minor); }
  private fromValue(v: unknown) { return this.cfg.amountUnit === 'major' ? Math.round(Number(v) * 100) : Math.round(Number(v)); }

  /** Signed POST to the wallet; checks the wallet's signature on the reply when its key is configured. */
  async call<T = any>(fullPath: string, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    const time = new Date().toISOString();
    const sig = rsaSign(signContent('POST', fullPath, this.cfg.clientId, time, body), this.key);
    const res = await fetch(this.cfg.gatewayUrl.replace(/\/+$/, '') + fullPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'client-id': this.cfg.clientId,
        'request-time': time,
        signature: `algorithm=RSA256, keyVersion=${this.cfg.keyVersion ?? '1'}, signature=${sig}`
      },
      body,
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000)
    });
    const text = await res.text();
    if (this.platformKey) {
      const rsig = signatureValue(res.headers.get('signature') ?? undefined);
      const content = signContent('POST', fullPath, res.headers.get('client-id') ?? this.cfg.clientId, res.headers.get('response-time') ?? '', text);
      if (!rsig || !rsaVerify(content, rsig, this.platformKey)) throw new Error(`M-Pesa reply to ${fullPath} has no valid signature (HTTP ${res.status})`);
    }
    let json: any;
    try { json = JSON.parse(text); } catch { throw new Error(`M-Pesa reply to ${fullPath} is not JSON (HTTP ${res.status})`); }
    return json as T;
  }

  async exchangeAuthCode(authCode: string): Promise<MpesaUser> {
    const t = await this.call<any>(this.path('/v2/authorizations/applyToken'), {
      appId: this.cfg.appId, authClientId: this.cfg.authClientId, grantType: 'AUTHORIZATION_CODE', authCode
    });
    if (t?.result?.resultStatus !== 'S' || !t.customerId) {
      throw new Error(`M-Pesa login refused: ${t?.result?.resultCode ?? 'UNKNOWN'} ${t?.result?.resultMessage ?? ''}`.trim());
    }
    let name = '', phone: string | null = null;
    try {
      const u = await this.call<any>(this.cfg.userInfoPath ?? this.path('/v1/customers/user/inquiryUserInfo'),
        { authClientId: this.cfg.authClientId, accessToken: t.accessToken });
      const info = u?.userInfo ?? u?.user ?? u ?? {};
      name = String(info.userName?.fullName ?? info.fullName ?? info.nickName ?? (typeof info.userName === 'string' ? info.userName : '') ?? '').trim();
      const contact = (info.contactInfos ?? []).find((c: any) => /PHONE|MOBILE|MSISDN/i.test(String(c.contactType ?? '')));
      phone = normMsisdn(contact?.contactNo ?? info.mobilePhone ?? info.phoneNo ?? info.msisdn ?? info.loginId ?? '');
    } catch {
      // the profile is optional: without it the customer gives an SMS number at checkout
    }
    return { userId: String(t.customerId), msisdn: phone, name };
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const paymentRequestId = input.paymentId.replace(/-/g, '');
    const amount = { currency: this.cfg.currency ?? 'ETB', value: this.toValue(input.amountMinor) };
    const expiry = new Date(Date.now() + (this.cfg.paymentTimeoutSecs ?? 900) * 1000).toISOString();
    const req = {
      appId: this.cfg.appId,
      productCode: this.cfg.productCode ?? 'CASHIER_PAYMENT',
      paymentRequestId,
      paymentAmount: amount,
      order: {
        referenceOrderId: input.reference,
        orderDescription: input.description.slice(0, 256),
        orderAmount: amount,
        orderCreateTime: (input.orderCreatedAt ?? new Date()).toISOString()
      },
      paymentNotifyUrl: input.callbackUrl,
      paymentExpiryTime: expiry
    };
    const r = await this.call<any>(this.path('/v2/payments/pay'), req);
    const st = r?.result?.resultStatus, code = String(r?.result?.resultCode ?? '');
    const url = r?.redirectActionForm?.redirectionUrl ?? r?.redirectActionForm?.redirectUrl ?? r?.paymentUrl;
    const raw = { request: req, response: r };
    if (st === 'F') throw new Error(`M-Pesa refused the payment: ${code} ${r?.result?.resultMessage ?? ''}`.trim());
    if (st === 'S') {
      return { checkoutRequestId: paymentRequestId, merchantRequestId: r.paymentId, raw,
        immediate: { checkoutRequestId: paymentRequestId, merchantRequestId: r.paymentId, status: 'succeeded', resultCode: code || 'SUCCESS', resultDesc: 'paid', receiptNumber: r.paymentId, amountMinor: input.amountMinor } };
    }
    // A (accepted) or U (unknown): the customer pays in the M-Pesa cashier; U is settled by inquiryPayment
    return { checkoutRequestId: paymentRequestId, merchantRequestId: r?.paymentId, raw,
      clientAction: url ? { type: 'tradePay', paymentUrl: String(url) } : undefined };
  }

  parseCallback(body: unknown): PaymentOutcome | null {
    const b = body as any;
    if (!b || typeof b.paymentRequestId !== 'string') return null;
    const res = b.paymentResult;
    let status: PaymentOutcome['status'];
    if (res?.resultStatus === 'S' || (!res && b.paymentTime)) status = 'succeeded';
    else if (res?.resultStatus === 'F') status = /CANCEL/i.test(String(res.resultCode)) ? 'cancelled' : 'failed';
    else return null;   // U or unknown: wait for the inquiry
    return {
      checkoutRequestId: b.paymentRequestId, merchantRequestId: b.paymentId, status,
      resultCode: String(res?.resultCode ?? 'SUCCESS'), resultDesc: String(res?.resultMessage ?? ''),
      receiptNumber: b.paymentId ? String(b.paymentId) : undefined,
      amountMinor: b.paymentAmount?.value != null ? this.fromValue(b.paymentAmount.value) : undefined
    };
  }

  async query(checkoutRequestId: string): Promise<PaymentOutcome | null> {
    const r = await this.call<any>(this.path('/v2/payments/inquiryPayment'), { paymentRequestId: checkoutRequestId });
    if (r?.result?.resultStatus !== 'S') return null;
    const ps = String(r.paymentStatus ?? r.paymentResult?.resultStatus ?? '').toUpperCase();
    const base = {
      checkoutRequestId, merchantRequestId: r.paymentId, resultCode: ps, resultDesc: String(r.paymentResult?.resultMessage ?? ''),
      receiptNumber: r.paymentId ? String(r.paymentId) : undefined,
      amountMinor: r.paymentAmount?.value != null ? this.fromValue(r.paymentAmount.value) : undefined
    };
    if (ps === 'SUCCESS' || ps === 'S') return { ...base, status: 'succeeded' };
    if (ps === 'CANCELLED' || ps === 'CLOSED') return { ...base, status: 'cancelled' };
    if (ps === 'FAIL' || ps === 'FAILED' || ps === 'F') return { ...base, status: 'failed' };
    return null;   // PROCESSING / INIT
  }

  /** Checks the wallet's signature on a notification (content uses Request-Time, like requests). */
  verifyCallback(rawBody: string, headers: Record<string, string | string[] | undefined>, path: string): boolean {
    if (!this.platformKey) return false;
    const sig = signatureValue(h1(headers['signature']));
    if (!sig) return false;
    const content = signContent('POST', path, h1(headers['client-id']) || this.cfg.clientId, h1(headers['request-time']), rawBody);
    return rsaVerify(content, sig, this.platformKey);
  }

  callbackReply(ok: boolean, path: string) {
    const body = JSON.stringify({ result: ok
      ? { resultCode: 'SUCCESS', resultStatus: 'S', resultMessage: 'success' }
      : { resultCode: 'UNKNOWN_EXCEPTION', resultStatus: 'U', resultMessage: 'please retry' } });
    const time = new Date().toISOString();
    return {
      body,
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'client-id': this.cfg.clientId,
        'response-time': time,
        signature: `algorithm=RSA256, keyVersion=${this.cfg.keyVersion ?? '1'}, signature=${rsaSign(signContent('POST', path, this.cfg.clientId, time, body), this.key)}`
      }
    };
  }
}
