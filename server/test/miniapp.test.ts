import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeCtx, reset, addStock, drainJobs } from './helpers.js';
import { keyPair, startFakeGateway } from './fakes/miniapp.js';
import { MiniAppPayments, rsaSign, rsaVerify, signContent, signatureValue, readPem } from '../src/adapters/payments/miniapp.js';
import { buildApp } from '../src/http/app.js';
import { checkPaymentJob } from '../src/services/payments.js';
import { one } from '../src/db/pool.js';

const merchant = keyPair(), platform = keyPair();
const CLIENT_ID = 'TEST_CLIENT_2026';
const SECRET = 'test-callback-secret-0123456789';
const NOTIFY_PATH = `/v1/webhooks/mpesa-miniapp/${SECRET}`;
let gw: Awaited<ReturnType<typeof startFakeGateway>>;
let adapter: MiniAppPayments;
let ctx: ReturnType<typeof makeCtx>;
let app: FastifyInstance;

beforeAll(async () => {
  gw = await startFakeGateway({ merchantPub: merchant.pub, platformPriv: platform.priv, clientId: CLIENT_ID });
  adapter = new MiniAppPayments({
    gatewayUrl: gw.url, clientId: CLIENT_ID, appId: '3500020170000001', authClientId: 'AUTH01',
    privateKeyPem: merchant.priv, platformPublicKeyPem: platform.pub, currency: 'ETB'
  });
  ctx = makeCtx({ payments: adapter });
  app = await buildApp(ctx);
});
afterAll(async () => { await app.close(); await gw.close(); await ctx.db.end(); });
beforeEach(async () => {
  await reset(ctx);
  await addStock(ctx, 'netflix', 50, 5);
  gw.state.payments.clear(); gw.state.next = []; gw.state.noPhone = false; gw.state.badReplySignatures = false; gw.state.requests.length = 0;
});

const call = (method: string, url: string, token?: string, payload?: unknown) =>
  app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function login(code = 'good-0001') {
  const r = await call('POST', '/v1/auth/mpesa', undefined, { authCode: code });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { token: string; customer: any };
}

async function orderAndPay(token: string) {
  const order = (await call('POST', '/v1/orders', token, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }] })).json();
  const pay = await call('POST', `/v1/orders/${order.id}/pay`, token);
  expect(pay.statusCode, pay.body).toBe(200);
  return { order, pay: pay.json() };
}

describe('signatures', () => {
  it('sign and verify round trip; any change breaks it', () => {
    const c = signContent('POST', '/api/v2/payments/pay', CLIENT_ID, '2026-11-01T10:00:00.000Z', '{"a":1}');
    expect(c).toBe(`POST /api/v2/payments/pay\n${CLIENT_ID}.2026-11-01T10:00:00.000Z.{"a":1}`);
    const sig = signatureValue(`algorithm=RSA256, keyVersion=1, signature=${rsaSign(c, merchant.priv)}`)!;
    expect(rsaVerify(c, sig, merchant.pub)).toBe(true);
    expect(rsaVerify(c.replace('"a":1', '"a":2'), sig, merchant.pub)).toBe(false);
    expect(rsaVerify(c, sig, platform.pub)).toBe(false);
  });
  it('reads keys as PEM, escaped PEM or base64', () => {
    expect(readPem(merchant.pub)).toBe(merchant.pub.trim());
    expect(readPem(merchant.pub.trim().replace(/\n/g, '\\n'))).toBe(merchant.pub.trim());
    expect(readPem(Buffer.from(merchant.pub).toString('base64'))).toBe(merchant.pub);
  });
});

describe('M-Pesa mini program flow', () => {
  it('login: auth code → applyToken → name and phone from the profile', async () => {
    const { customer } = await login();
    expect(customer).toMatchObject({ name: 'Hana Tesfaye', msisdn: '+251712345482' });
    expect(gw.state.requests.map(r => [r.path, r.signedOk])).toEqual([
      ['/api/v2/authorizations/applyToken', true], ['/api/v1/customers/user/inquiryUserInfo', true]]);
    expect((await one(ctx.db, `SELECT mpesa_user_id FROM customers`)).mpesa_user_id).toBe('MP0001');
    expect((await call('POST', '/v1/auth/mpesa', undefined, { authCode: 'bad' })).statusCode).toBe(401);
  });

  it('pay: signed payments/pay in santim, cashier URL for my.tradePay, signed notification → codes', async () => {
    const { token } = await login();
    const { order, pay } = await orderAndPay(token);
    expect(pay.clientAction).toMatchObject({ type: 'tradePay', paymentUrl: expect.stringMatching(/^https:\/\/cashier\.example\/pay/) });
    const sent = [...gw.state.payments.values()][0]!.req;
    expect(sent).toMatchObject({
      appId: '3500020170000001', productCode: 'CASHIER_PAYMENT', paymentAmount: { currency: 'ETB', value: String(order.totalMinor) },
      order: { referenceOrderId: order.reference }, paymentNotifyUrl: `http://localhost:8080${NOTIFY_PATH}`
    });
    expect(sent.paymentRequestId).toBe(pay.id.replace(/-/g, ''));

    const n = gw.notification(NOTIFY_PATH, sent.paymentRequestId, true);
    const r = await app.inject({ method: 'POST', url: NOTIFY_PATH, payload: n.body, headers: n.headers });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ result: { resultCode: 'SUCCESS', resultStatus: 'S', resultMessage: 'success' } });
    // our reply is signed too, verifiable with our public key
    const content = signContent('POST', NOTIFY_PATH, String(r.headers['client-id']), String(r.headers['response-time']), r.body);
    expect(rsaVerify(content, signatureValue(String(r.headers['signature']))!, merchant.pub)).toBe(true);

    await drainJobs(ctx);
    const done = (await call('GET', `/v1/orders/${order.id}`, token)).json();
    expect(done.status).toBe('completed');
    expect(done.payment.receipt).toMatch(/^PAY/);
    expect(done.items[0].codes).toHaveLength(1);
    // the same notification again changes nothing
    const again = await app.inject({ method: 'POST', url: NOTIFY_PATH, payload: n.body, headers: n.headers });
    expect(again.json().result.resultStatus).toBe('S');
    expect((await one(ctx.db, `SELECT count(*)::int n FROM gift_codes WHERE status = 'sold'`)).n).toBe(1);
  });

  it('a forged or unsigned notification is refused and changes nothing', async () => {
    const { token } = await login();
    const { order } = await orderAndPay(token);
    const reqId = [...gw.state.payments.keys()][0]!;
    const forged = gw.notification(NOTIFY_PATH, reqId, true, keyPair().priv);
    expect((await app.inject({ method: 'POST', url: NOTIFY_PATH, payload: forged.body, headers: forged.headers })).statusCode).toBe(401);
    const unsigned = await app.inject({ method: 'POST', url: NOTIFY_PATH, payload: forged.body, headers: { 'content-type': 'application/json' } });
    expect(unsigned.statusCode).toBe(401);
    expect((await call('GET', `/v1/orders/${order.id}`, token)).json().status).toBe('pending_payment');
    expect((await app.inject({ method: 'POST', url: '/v1/webhooks/mpesa-miniapp/wrong', payload: forged.body, headers: forged.headers })).statusCode).toBe(404);
  });

  it('customer cancels in the cashier: order stays payable', async () => {
    const { token } = await login();
    const { order } = await orderAndPay(token);
    const n = gw.notification(NOTIFY_PATH, [...gw.state.payments.keys()][0]!, false);
    expect((await app.inject({ method: 'POST', url: NOTIFY_PATH, payload: n.body, headers: n.headers })).statusCode).toBe(200);
    const o = (await call('GET', `/v1/orders/${order.id}`, token)).json();
    expect(o.status).toBe('pending_payment');
    expect(o.payment.status).toBe('cancelled');
  });

  it('notification never arrives: the check job asks inquiryPayment and delivers', async () => {
    const { token } = await login();
    const { order, pay } = await orderAndPay(token);
    await checkPaymentJob(ctx, { paymentId: pay.id }).catch(() => {});   // still processing
    gw.state.payments.get(pay.id.replace(/-/g, ''))!.status = 'SUCCESS';
    await checkPaymentJob(ctx, { paymentId: pay.id });
    await drainJobs(ctx);
    expect((await call('GET', `/v1/orders/${order.id}`, token)).json().status).toBe('completed');
  });

  it('wallet refuses the payment: clear error, nothing open', async () => {
    const { token } = await login();
    const order = (await call('POST', '/v1/orders', token, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }] })).json();
    gw.state.next = ['fail'];
    const r = await call('POST', `/v1/orders/${order.id}/pay`, token);
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toBe('payment_unavailable');
  });

  it('a reply without a valid wallet signature is not trusted', async () => {
    gw.state.badReplySignatures = true;
    expect((await call('POST', '/v1/auth/mpesa', undefined, { authCode: 'good-0002' })).statusCode).toBe(401);
  });

  it('no phone number shared: the customer logs in and gives an SMS number at checkout', async () => {
    gw.state.noPhone = true;
    const { token, customer } = await login('good-0003');
    expect(customer.msisdn).toBeNull();
    const noNumber = await call('POST', '/v1/orders', token, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }], deliverBy: 'sms' });
    expect(noNumber.json().error).toBe('phoneNeeded');
    const ok = await call('POST', '/v1/orders', token, { items: [{ brandId: 'netflix', faceValueUsd: 50, quantity: 1 }], deliverBy: 'sms', deliverTo: '0911223344' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().delivery.to).toBe('+251911223344');
    expect((await call('POST', `/v1/orders/${ok.json().id}/pay`, token)).json().clientAction.type).toBe('tradePay');
  });
});
