import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { makeCtx, reset, addStock, drainJobs } from './helpers.js';
import { MpesaEtPayments, billReferenceFor, birrString } from '../src/adapters/payments/mpesaEt.js';
import { buildApp } from '../src/http/app.js';
import { many, one } from '../src/db/pool.js';

const SHORTCODE = '40444';
const SECRET = 'test-callback-secret-0123456789';
const adapter = new MpesaEtPayments({ shortcode: SHORTCODE, baseUrl: 'http://127.0.0.1:1', consumerKey: 'ck', consumerSecret: 'cs' });
const ctx = makeCtx({ payments: adapter });
let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(ctx); });
afterAll(async () => { await app.close(); await ctx.db.end(); });
beforeEach(async () => { await reset(ctx); await addStock(ctx, 'netflix', 50, 5); });

const DEVICE_A = 'device-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEVICE_B = 'device-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const call = (method: string, url: string, token?: string, payload?: unknown) =>
  app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });

/** What my.call('userScopes') returns, turned into our login body (as assets/ecards-api.js does). */
async function login(device = DEVICE_A, userId = '251799123456001', mobile = '251799123456') {
  const r = await call('POST', '/v1/auth/mpesa', undefined, { profile: { userId, name: 'Dawit Tadesse', msisdn: mobile }, deviceKey: device });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { token: string; customer: any };
}

async function orderAndPay(token: string) {
  const order = (await call('POST', '/v1/orders', token, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }] })).json();
  const pay = (await call('POST', `/v1/orders/${order.id}/pay`, token)).json();
  return { order, pay };
}

/** The C2B bodies exactly as in the M-Pesa Ethiopia docs, with our values. */
const c2b = (type: 'Validation' | 'Confirmation', billRef: string, amountBirr: string, transId = 'QAYGDMWP8S') => ({
  RequestType: type, TransactionType: 'Pay Bill', TransID: transId, TransTime: '20261101091011', TransAmount: amountBirr,
  BusinessShortCode: SHORTCODE, BillRefNumber: billRef, InvoiceNumber: '', OrgAccountBalance: '4275.00', ThirdPartyTransID: '',
  MSISDN: '251799123456', FirstName: 'Dawit', MiddleName: '', LastName: 'Tadesse'
});
const C2B = `/v1/webhooks/mpesa-c2b/${SECRET}`;

describe('M-Pesa Ethiopia adapter', () => {
  it('formats amounts and bill references', () => {
    expect(birrString(1_325_000)).toBe('13250.0');
    expect(birrString(15_000)).toBe('150.0');
    expect(billReferenceFor('EC12345678')).toBe('EC12345678');
    expect(billReferenceFor('EC12345678', 2)).toBe('EC12345678R2');
  });
  it('reads a C2B confirmation; ignores validations and other shortcodes', () => {
    expect(adapter.parseCallback(c2b('Confirmation', 'EC1', '150'))).toMatchObject({
      checkoutRequestId: 'EC1', status: 'succeeded', receiptNumber: 'QAYGDMWP8S', amountMinor: 15000, msisdn: '+251799123456' });
    expect(adapter.parseCallback(c2b('Validation', 'EC1', '150'))).toBeNull();
    expect(adapter.parseCallback({ ...c2b('Confirmation', 'EC1', '150'), BusinessShortCode: '99999' })).toBeNull();
  });
});

describe('H5 mini app flow (userScopes + payWithMpesa + C2B)', () => {
  it('login, pay instruction for my.call, validation, confirmation, codes', async () => {
    const { token, customer } = await login();
    expect(customer).toMatchObject({ name: 'Dawit Tadesse', msisdn: '+251799123456' });
    const { order, pay } = await orderAndPay(token);
    expect(pay.clientAction).toEqual({ type: 'payWithMpesa', businessID: SHORTCODE, billReference: order.reference,
      amount: birrString(order.totalMinor), currency: 'ETB', reason: `eCards ${order.reference}` });

    // M-Pesa asks before taking the money
    expect((await call('POST', `${C2B}/validation`, undefined, c2b('Validation', 'EC00000000', '100'))).json()).toEqual({ ResultCode: 'C2B00012', ResultDesc: 'Invalid Account Number' });
    expect((await call('POST', `${C2B}/validation`, undefined, c2b('Validation', order.reference, '1'))).json()).toEqual({ ResultCode: 'C2B00013', ResultDesc: 'Invalid Amount' });
    expect((await call('POST', `${C2B}/validation`, undefined, c2b('Validation', order.reference, String(order.totalMinor / 100)))).json())
      .toEqual({ ResultCode: 0, ResultDesc: 'Request processed successfully' });

    // the app reports success (informational), then the money is confirmed by M-Pesa
    expect((await call('POST', `/v1/orders/${order.id}/pay-result`, token, { paymentId: pay.id, status: 'success', transactionId: 'NLI1HBTZUK' })).statusCode).toBe(200);
    expect((await call('GET', `/v1/orders/${order.id}`, token)).json().status).toBe('pending_payment');
    const conf = await call('POST', `${C2B}/confirmation`, undefined, c2b('Confirmation', order.reference, String(order.totalMinor / 100)));
    expect(conf.json()).toEqual({ ResultCode: 0, ResultDesc: 'Request processed successfully' });
    await drainJobs(ctx);
    const done = (await call('GET', `/v1/orders/${order.id}`, token)).json();
    expect(done).toMatchObject({ status: 'completed', payment: { receipt: 'QAYGDMWP8S' } });
    expect(done.items[0].codes).toHaveLength(1);
    // the same confirmation again changes nothing
    await call('POST', `${C2B}/confirmation`, undefined, c2b('Confirmation', order.reference, String(order.totalMinor / 100)));
    expect((await one(ctx.db, `SELECT count(*)::int n FROM gift_codes WHERE status = 'sold'`)).n).toBe(1);
  });

  it('cancel in M-Pesa → try again with a new bill reference; a late confirmation of either still counts once', async () => {
    const { token } = await login();
    const { order, pay } = await orderAndPay(token);
    await call('POST', `/v1/orders/${order.id}/pay-result`, token, { paymentId: pay.id, status: 'cancelled', error: 201, errorMessage: 'Canceled by user' });
    expect((await call('GET', `/v1/orders/${order.id}`, token)).json().payment.status).toBe('cancelled');
    const again = (await call('POST', `/v1/orders/${order.id}/pay`, token)).json();
    expect(again.clientAction.billReference).toBe(`${order.reference}R2`);
    // the second attempt is paid
    await call('POST', `${C2B}/confirmation`, undefined, c2b('Confirmation', `${order.reference}R2`, String(order.totalMinor / 100), 'TX2'));
    await drainJobs(ctx);
    expect((await call('GET', `/v1/orders/${order.id}`, token)).json().status).toBe('completed');
  });

  it('wrong amount or unknown reference in a confirmation: acknowledged, never fulfilled, flagged for staff', async () => {
    const { token } = await login();
    const { order } = await orderAndPay(token);
    await call('POST', `${C2B}/confirmation`, undefined, c2b('Confirmation', order.reference, '5', 'TXLOW'));
    await call('POST', `${C2B}/confirmation`, undefined, c2b('Confirmation', 'SOMETHING-ELSE', '100', 'TXUNK'));
    await drainJobs(ctx);
    expect((await call('GET', `/v1/orders/${order.id}`, token)).json().status).toBe('pending_payment');
    expect((await many(ctx.db, `SELECT action FROM audit_log`)).map(a => a.action)).toContain('payment.amount_mismatch');
    expect((await one(ctx.db, `SELECT count(*)::int n FROM webhook_events WHERE error = 'unknown_payment'`)).n).toBe(1);
  });

  it('callbacks with the wrong secret are refused', async () => {
    expect((await call('POST', '/v1/webhooks/mpesa-c2b/guess/confirmation', undefined, c2b('Confirmation', 'X', '1'))).statusCode).toBe(404);
    expect((await call('POST', '/v1/webhooks/mpesa-c2b/guess/validation', undefined, c2b('Validation', 'X', '1'))).statusCode).toBe(404);
  });

  it('identity sent by the app cannot reveal codes on another device', async () => {
    const a = await login(DEVICE_A);
    const { order } = await orderAndPay(a.token);
    await call('POST', `${C2B}/confirmation`, undefined, c2b('Confirmation', order.reference, String(order.totalMinor / 100)));
    await drainJobs(ctx);
    // same M-Pesa user id from another device (or someone faking it): sees the order, not the codes
    const b = await login(DEVICE_B);
    expect(b.customer.id).toBe(a.customer.id);
    const seenByB = (await call('GET', `/v1/orders/${order.id}`, b.token)).json();
    expect(seenByB.status).toBe('completed');
    expect(seenByB.items[0]).toMatchObject({ codes: [], codesHidden: true });
    const listB = (await call('GET', '/v1/orders?full=1', b.token)).json().orders;
    expect(listB[0].items[0].codes).toEqual([]);
    // the ordering device still sees them
    expect((await call('GET', `/v1/orders/${order.id}`, a.token)).json().items[0].codes).toHaveLength(1);
  });

  it('profile login needs a device key and a user id; auth-code login is refused on this adapter', async () => {
    expect((await call('POST', '/v1/auth/mpesa', undefined, { profile: { userId: '1234567' }, deviceKey: 'short' })).statusCode).toBe(400);
    expect((await call('POST', '/v1/auth/mpesa', undefined, { profile: { userId: '' }, deviceKey: DEVICE_A })).statusCode).toBe(400);
    expect((await call('POST', '/v1/auth/mpesa', undefined, { authCode: 'mock:0712345678:x' })).statusCode).toBe(401);
  });
});

describe('registering the C2B URLs', () => {
  it('sends the documented body to /v1/c2b-register-url/register with the consumer key', async () => {
    const seen: any[] = [];
    const fake = Fastify();
    fake.post('/v1/c2b-register-url/register', async req => { seen.push({ q: req.query, body: req.body }); return { ResponseCode: '200', ResponseDescription: 'Success' }; });
    await fake.listen({ port: 0, host: '127.0.0.1' });
    const a = new MpesaEtPayments({ shortcode: SHORTCODE, baseUrl: `http://127.0.0.1:${(fake.server.address() as any).port}`, consumerKey: 'KEY 1', consumerSecret: 's' });
    const r = await a.registerUrls('https://ecards.paperless.et/c', 'https://ecards.paperless.et/v');
    await fake.close();
    expect(r.http).toBe(200);
    expect(seen[0]).toEqual({ q: { apikey: 'KEY 1' }, body: { ShortCode: SHORTCODE, ResponseType: 'Completed', CommandID: 'RegisterURL',
      ConfirmationURL: 'https://ecards.paperless.et/c', ValidationURL: 'https://ecards.paperless.et/v' } });
  });
});
