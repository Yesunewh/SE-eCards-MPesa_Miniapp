import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { parse } from '../app.js';
import { maybeOne } from '../../db/pool.js';
import { safeEqual } from '../../lib/crypto.js';
import { AppError, notFound } from '../../lib/util.js';
import { handleMpesaCallback } from '../../services/payments.js';
import { mockCallback, MockPayments } from '../../adapters/payments/mock.js';

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

  /** Development only: approve or decline a mock M-Pesa payment, as if the customer entered their PIN. */
  if (ctx.payments instanceof MockPayments && ctx.cfg.NODE_ENV !== 'production') {
    app.post('/dev/mpesa/simulate', async req => {
      const b = parse(z.object({ paymentId: z.string().uuid(), ok: z.boolean().default(true), amountMinor: z.number().int().optional() }), req.body);
      const p = await maybeOne(ctx.db, `SELECT checkout_request_id, amount_minor, msisdn FROM payments WHERE id = $1`, [b.paymentId]);
      if (!p?.checkout_request_id) throw new AppError(404, 'payment_not_found');
      return handleMpesaCallback(ctx, mockCallback(p.checkout_request_id, { ok: b.ok, amountMinor: b.amountMinor ?? p.amount_minor, msisdn: p.msisdn }));
    });
  }
}
