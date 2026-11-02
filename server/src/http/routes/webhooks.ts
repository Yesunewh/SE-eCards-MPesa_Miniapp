import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../context.js';
import { parse } from '../app.js';
import { safeEqual } from '../../lib/crypto.js';
import { notFound } from '../../lib/util.js';
import { handleC2bValidation, handleMpesaCallback } from '../../services/payments.js';

export async function webhookRoutes(app: FastifyInstance, ctx: Ctx) {
  /**
   * M-Pesa result callback. M-Pesa does not sign callbacks, so the URL carries a long secret
   * (MPESA_CALLBACK_SECRET); allow-list Safaricom's callback IPs at the proxy as well.
   * Always answers 200 once the event is stored, so M-Pesa does not keep retrying.
   */
  app.post('/webhooks/mpesa/:secret', async (req, reply) => {
    const expected = ctx.cfg.MPESA_CALLBACK_SECRET || 'dev';
    if (!safeEqual(String((req.params as any).secret), expected)) throw notFound('not_found');
    const r = await handleMpesaCallback(ctx, req.body, { 'user-agent': req.headers['user-agent'] ?? null, ip: req.ip });
    return reply.status(200).send({ ResultCode: 0, ResultDesc: 'Accepted', ...(ctx.cfg.NODE_ENV !== 'production' ? { result: r } : {}) });
  });

  /**
   * M-Pesa Ethiopia C2B (payWithMpesa in the H5 mini app). Unsigned, like all Daraja-style callbacks, so the URL
   * carries MPESA_CALLBACK_SECRET (registered with npm run mpesa:register-urls) and every payment is checked against
   * an open payment of ours for the exact amount. Replies use the documented { ResultCode, ResultDesc }.
   */
  const c2bSecretOk = (req: any) => safeEqual(String(req.params.secret), ctx.cfg.MPESA_CALLBACK_SECRET || 'dev');
  app.post('/webhooks/mpesa-c2b/:secret/validation', async (req, reply) => {
    if (!c2bSecretOk(req)) throw notFound('not_found');
    return reply.status(200).send(await handleC2bValidation(ctx, req.body));
  });
  app.post('/webhooks/mpesa-c2b/:secret/confirmation', async (req, reply) => {
    if (!c2bSecretOk(req)) throw notFound('not_found');
    try {
      await handleMpesaCallback(ctx, req.body, { ip: req.ip, kind: 'c2b-confirmation' });
    } catch (e) {
      req.log.error(e);   // stored in webhook_events; the money has moved, so we still acknowledge
    }
    return reply.status(200).send({ ResultCode: 0, ResultDesc: 'Request processed successfully' });
  });

  /**
   * M-Pesa mini program payment result (notifyPayment). Signed by the wallet with RSA256: the raw body is kept
   * so the signature can be checked byte for byte. We answer with the signed { result } the wallet expects;
   * resultStatus U makes the wallet send it again.
   */
  await app.register(async scoped => {
    scoped.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as any).rawBody = body;
      try { done(null, body ? JSON.parse(body as string) : {}); } catch (e) { done(e as Error, undefined); }
    });
    scoped.post('/webhooks/mpesa-miniapp/:secret', async (req, reply) => {
      const expected = ctx.cfg.MPESA_CALLBACK_SECRET || 'dev';
      if (!safeEqual(String((req.params as any).secret), expected)) throw notFound('not_found');
      const adapter = ctx.payments;
      const path = req.url.split('?')[0]!;
      const raw: string = (req as any).rawBody ?? '';
      const send = (ok: boolean) => {
        const r = adapter.callbackReply?.(ok, path);
        if (!r) return reply.status(200).send({ result: { resultCode: ok ? 'SUCCESS' : 'UNKNOWN_EXCEPTION', resultStatus: ok ? 'S' : 'U' } });
        return reply.status(200).headers(r.headers).send(r.body);
      };
      const signed = adapter.verifyCallback ? adapter.verifyCallback(raw, req.headers, path) : false;
      if (adapter.verifyCallback && !signed && (ctx.cfg.NODE_ENV === 'production' || (adapter as any).hasPlatformKey)) {
        await ctx.db.query(`INSERT INTO webhook_events (source, payload, headers, verified, error, processed_at) VALUES ('mpesa', $1, $2, false, 'bad signature', now())`,
          [JSON.stringify(req.body ?? null), { 'client-id': req.headers['client-id'] ?? null, ip: req.ip }]);
        return reply.status(401).send({ result: { resultCode: 'INVALID_SIGNATURE', resultStatus: 'F', resultMessage: 'invalid signature' } });
      }
      try {
        await handleMpesaCallback(ctx, req.body, { 'client-id': req.headers['client-id'] ?? null, ip: req.ip, signed });
        return send(true);
      } catch (e) {
        req.log.error(e);
        return send(false);
      }
    });
  });

}
