/** A stand-in M-Pesa mini program gateway: checks our RSA signatures and signs its replies like the real one. */
import Fastify from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { rsaSign, rsaVerify, signContent, signatureValue } from '../../src/adapters/payments/miniapp.js';

export function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

export async function startFakeGateway(o: { merchantPub: string; platformPriv: string; clientId: string }) {
  const state = {
    payments: new Map<string, { req: any; paymentId: string; status: 'PROCESSING' | 'SUCCESS' | 'FAIL' }>(),
    next: [] as Array<'fail' | 'accept' | 'success'>,
    noPhone: false,
    badReplySignatures: false,
    requests: [] as Array<{ path: string; body: any; signedOk: boolean }>
  };
  const app = Fastify();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => { (req as any).raw0 = body; done(null, JSON.parse(body as string)); });

  // every request must be signed by the merchant; every reply is signed by the platform
  app.addHook('preHandler', async (req, reply) => {
    const content = signContent('POST', req.url, String(req.headers['client-id']), String(req.headers['request-time']), (req as any).raw0 ?? '');
    const sig = signatureValue(String(req.headers['signature'] ?? ''));
    const ok = !!sig && req.headers['client-id'] === o.clientId && rsaVerify(content, sig, o.merchantPub);
    state.requests.push({ path: req.url, body: req.body, signedOk: ok });
    if (!ok) return reply.status(401).send({ result: { resultCode: 'INVALID_SIGNATURE', resultStatus: 'F' } });
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const time = new Date().toISOString();
    const key = state.badReplySignatures ? keyPair().priv : o.platformPriv;
    reply.header('client-id', o.clientId).header('response-time', time)
      .header('signature', `algorithm=RSA256, keyVersion=1, signature=${rsaSign(signContent('POST', req.url, o.clientId, time, String(payload)), key)}`);
    return payload;
  });

  const S = { resultCode: 'SUCCESS', resultStatus: 'S', resultMessage: 'success' };
  app.post('/api/v2/authorizations/applyToken', async req => {
    const b = req.body as any;
    if (b.grantType !== 'AUTHORIZATION_CODE' || !String(b.authCode).startsWith('good-')) return { result: { resultCode: 'INVALID_CODE', resultStatus: 'F' } };
    return { result: S, customerId: 'MP' + String(b.authCode).slice(5), accessToken: 'AT-' + b.authCode, accessTokenExpiryTime: new Date(Date.now() + 3600e3).toISOString() };
  });
  app.post('/api/v1/customers/user/inquiryUserInfo', async req => {
    const b = req.body as any;
    if (!String(b.accessToken).startsWith('AT-')) return { result: { resultCode: 'INVALID_ACCESS_TOKEN', resultStatus: 'F' } };
    return { result: S, userInfo: { userId: 'u1', nickName: 'Hana', userName: { fullName: 'Hana Tesfaye' },
      contactInfos: state.noPhone ? [] : [{ contactType: 'MOBILE_PHONE', contactNo: '0712345482' }] } };
  });
  app.post('/api/v2/payments/pay', async req => {
    const b = req.body as any;
    const mode = state.next.shift() ?? 'accept';
    if (mode === 'fail') return { result: { resultCode: 'USER_BALANCE_NOT_ENOUGH', resultStatus: 'F', resultMessage: 'balance' } };
    const existing = state.payments.get(b.paymentRequestId);
    const paymentId = existing?.paymentId ?? 'PAY' + Math.random().toString(36).slice(2, 12).toUpperCase();
    state.payments.set(b.paymentRequestId, { req: b, paymentId, status: mode === 'success' ? 'SUCCESS' : 'PROCESSING' });
    if (mode === 'success') return { result: S, paymentId, paymentTime: new Date().toISOString() };
    return { result: { resultCode: 'ACCEPT', resultStatus: 'A', resultMessage: 'accept' }, paymentId,
             redirectActionForm: { method: 'GET', redirectionUrl: `https://cashier.example/pay?paymentId=${paymentId}` } };
  });
  app.post('/api/v2/payments/inquiryPayment', async req => {
    const p = state.payments.get((req.body as any).paymentRequestId);
    if (!p) return { result: { resultCode: 'ORDER_NOT_EXIST', resultStatus: 'F' } };
    return { result: S, paymentId: p.paymentId, paymentStatus: p.status, paymentAmount: p.req.paymentAmount };
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;

  /** A notifyPayment as the wallet would send it to us, signed with the platform key. */
  function notification(path: string, paymentRequestId: string, ok: boolean, signWith = o.platformPriv) {
    const p = state.payments.get(paymentRequestId)!;
    if (p) p.status = ok ? 'SUCCESS' : 'FAIL';
    const body = JSON.stringify({
      paymentId: p?.paymentId ?? 'PAYX', paymentRequestId, paymentAmount: p?.req.paymentAmount ?? { currency: 'ETB', value: '1' },
      paymentTime: new Date().toISOString(),
      paymentResult: ok ? S : { resultCode: 'USER_CANCEL', resultStatus: 'F', resultMessage: 'cancelled' }
    });
    const time = new Date().toISOString();
    return { body, headers: { 'content-type': 'application/json', 'client-id': o.clientId, 'request-time': time,
      signature: `algorithm=RSA256, keyVersion=1, signature=${rsaSign(signContent('POST', path, o.clientId, time, body), signWith)}` } };
  }
  return { url: `http://127.0.0.1:${port}`, state, notification, close: () => app.close() };
}
