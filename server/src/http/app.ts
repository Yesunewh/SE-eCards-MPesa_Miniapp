import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError, type ZodType } from 'zod';
import type { Ctx } from '../context.js';
import { AppError } from '../lib/util.js';
import { customerFromToken, type Customer } from '../services/customers.js';
import { adminFromToken, type Admin } from '../services/admin.js';
import { customerRoutes } from './routes/customer.js';
import { adminRoutes } from './routes/admin.js';
import { webhookRoutes } from './routes/webhooks.js';

declare module 'fastify' {
  interface FastifyRequest { customer?: Customer; admin?: Admin; token?: string }
}

export const parse = <T>(schema: ZodType<T>, data: unknown): T => schema.parse(data);

const bearer = (req: FastifyRequest) => {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

export function customerAuth(ctx: Ctx) {
  return async (req: FastifyRequest) => {
    const t = bearer(req);
    const c = t ? await customerFromToken(ctx, t) : null;
    if (!c) throw new AppError(401, 'unauthorized');
    req.customer = c; req.token = t!;
  };
}

export function adminAuth(ctx: Ctx) {
  return async (req: FastifyRequest) => {
    const t = bearer(req);
    const a = t ? await adminFromToken(ctx, t) : null;
    if (!a) throw new AppError(401, 'unauthorized');
    req.admin = a; req.token = t!;
  };
}

export async function buildApp(ctx: Ctx): Promise<FastifyInstance> {
  const app = Fastify({
    logger: ctx.cfg.NODE_ENV === 'test' ? false : {
      level: 'info',
      // never log tokens or callback secrets
      redact: ['req.headers.authorization'],
      serializers: { req: r => ({ method: r.method, url: r.url.replace(/\/webhooks\/mpesa\/[^/?]+/, '/webhooks/mpesa/***') }) }
    },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024
  });

  await app.register(cors, {
    origin: ctx.cfg.corsOrigins.length ? ctx.cfg.corsOrigins : ctx.cfg.NODE_ENV !== 'production',
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  });
  // per-route limits on login, ordering and support; off in tests, which log in many times
  await app.register(rateLimit, { global: false, ...(ctx.cfg.NODE_ENV === 'test' ? { allowList: () => true } : {}) });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'invalid_request', details: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.code ?? 'bad_request', message: e.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal_error' });
  });

  app.get('/health', async () => {
    await ctx.db.query('SELECT 1');
    return { ok: true, payments: ctx.payments.name, time: new Date().toISOString() };
  });

  await app.register(async a => customerRoutes(a, ctx), { prefix: '/v1' });
  await app.register(async a => webhookRoutes(a, ctx), { prefix: '/v1' });
  await app.register(async a => adminRoutes(a, ctx), { prefix: '/v1/admin' });
  return app;
}
