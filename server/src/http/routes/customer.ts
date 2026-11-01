import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { customerAuth, parse } from '../app.js';
import { getCatalog } from '../../services/catalog.js';
import { loginWithMpesa, logout, publicCustomer, updateProfile } from '../../services/customers.js';
import { cancelOrder, createOrder, getOrder, listOrders, listOrdersFull, markCodeUsed } from '../../services/orders.js';
import { startPayment } from '../../services/payments.js';
import { addToWishlist, listWishlist, removeFromWishlist } from '../../services/wishlist.js';
import { customerReply, listTicketsForCustomer, markSeenByCustomer, openTicket } from '../../services/support.js';

const uuid = z.string().uuid();
const LANG = z.enum(['en', 'am', 'om', 'so', 'ti']);

const OrderBody = z.object({
  items: z.array(z.object({
    productId: uuid.optional(),
    brandId: z.string().max(40).optional(),
    faceValueUsd: z.number().positive().optional(),
    quantity: z.number().int().min(1).max(100)
  }).refine(l => l.productId || (l.brandId && l.faceValueUsd), 'productId or brandId + faceValueUsd is required')).min(1).max(20),
  deliverBy: z.enum(['email', 'sms']).optional(),
  deliverTo: z.string().max(200).optional(),
  lang: LANG.optional(),
  channel: z.enum(['miniapp', 'web']).optional()
});

export async function customerRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = customerAuth(ctx);

  app.get('/catalog', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=30');
    return getCatalog(ctx.db);
  });

  app.post('/auth/mpesa', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async req => {
    const b = parse(z.object({ authCode: z.string().min(1).max(2000) }), req.body);
    return loginWithMpesa(ctx, b.authCode, { ip: req.ip, userAgent: req.headers['user-agent'] });
  });

  app.register(async a => {
    a.addHook('preHandler', auth);

    a.post('/auth/logout', async req => { await logout(ctx, req.token!); return { ok: true }; });

    a.get('/me', async req => publicCustomer(req.customer!));
    a.patch('/me', async req => {
      const b = parse(z.object({
        lang: LANG.optional(), deliverBy: z.enum(['email', 'sms']).optional(),
        email: z.string().max(200).optional(), msisdn: z.string().max(20).optional()
      }), req.body);
      return updateProfile(ctx, req.customer!.id, b);
    });

    // ---- orders
    a.post('/orders', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
      const b = parse(OrderBody, req.body);
      const key = req.headers['idempotency-key'];
      const order = await createOrder(ctx, req.customer!, { ...b, idempotencyKey: typeof key === 'string' ? key.slice(0, 100) : undefined });
      return reply.status(201).send(order);
    });
    a.get('/orders', async req => ({
      orders: (req.query as any)?.full === '1' ? await listOrdersFull(ctx, req.customer!.id) : await listOrders(ctx, req.customer!.id)
    }));
    a.get('/orders/:id', async req => getOrder(ctx, req.customer!.id, (req.params as any).id));
    a.post('/orders/:id/pay', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req =>
      startPayment(ctx, req.customer!.id, parse(uuid, (req.params as any).id)));
    a.post('/orders/:id/cancel', async req => {
      await cancelOrder(ctx, req.customer!.id, parse(uuid, (req.params as any).id));
      return { ok: true };
    });
    a.post('/codes/:id/used', async req => {
      const b = parse(z.object({ used: z.boolean() }), req.body);
      await markCodeUsed(ctx, req.customer!.id, parse(uuid, (req.params as any).id), b.used);
      return { ok: true };
    });

    // ---- wishlist
    a.get('/wishlist', async req => ({ items: await listWishlist(ctx, req.customer!.id) }));
    a.put('/wishlist/:productId', async req => { await addToWishlist(ctx, req.customer!.id, parse(uuid, (req.params as any).productId)); return { ok: true }; });
    a.delete('/wishlist/:productId', async req => { await removeFromWishlist(ctx, req.customer!.id, parse(uuid, (req.params as any).productId)); return { ok: true }; });

    // ---- support
    a.get('/support/tickets', async req => ({ tickets: await listTicketsForCustomer(ctx, req.customer!.id) }));
    a.post('/support/tickets', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
      const b = parse(z.object({ topic: z.enum(['order', 'payment', 'pre', 'other']), text: z.string().min(1).max(4000), orderId: uuid.nullish() }), req.body);
      return reply.status(201).send(await openTicket(ctx, req.customer!, b));
    });
    a.post('/support/tickets/:id/messages', async req => {
      const b = parse(z.object({ text: z.string().min(1).max(4000) }), req.body);
      await customerReply(ctx, req.customer!.id, parse(uuid, (req.params as any).id), b.text);
      return { ok: true };
    });
    a.post('/support/tickets/:id/seen', async req => {
      await markSeenByCustomer(ctx, req.customer!.id, parse(uuid, (req.params as any).id));
      return { ok: true };
    });
  });
}
