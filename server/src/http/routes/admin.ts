import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { adminAuth, parse } from '../app.js';
import * as A from '../../services/admin.js';
import { getSettings } from '../../services/catalog.js';
import { paymentsNeedingReview, recordPaymentByStaff, unmatchedPayments, unpaidOrders } from '../../services/payments.js';
import { setRestockEta, stockOverview, uploadCodes, voidCode } from '../../services/stock.js';
import { listTicketsForStaff, staffReply } from '../../services/support.js';
import { addProviderValues, applyMappings, suggestMappings } from '../../services/providerMapping.js';
import { MEDIA_KINDS, removeBrandMedia, setBrandMedia } from '../../services/media.js';

const uuid = z.string().uuid();
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const id = (req: any, k = 'id') => parse(uuid, req.params[k]);

export async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async req => {
    const b = parse(z.object({ email: z.string().max(200), password: z.string().max(200) }), req.body);
    return A.adminLogin(ctx, b.email, b.password, req.ip);
  });

  app.register(async a => {
    a.addHook('preHandler', adminAuth(ctx));
    const role = (r: A.Role) => async (req: any) => A.requireRole(req.admin, r);

    a.post('/logout', async req => { await A.adminLogout(ctx, req.token!); return { ok: true }; });
    a.get('/me', async req => req.admin);
    a.get('/dashboard', async () => A.dashboard(ctx));

    // ---- orders & payments
    a.get('/orders', async req => {
      const q = parse(z.object({ q: z.string().max(100).optional(), status: z.string().max(30).optional(),
        limit: z.coerce.number().int().optional(), offset: z.coerce.number().int().optional() }), req.query);
      if ((req.query as any)?.full === '1') return { orders: await A.ordersForPanel(ctx, q.limit) };
      return { orders: await A.searchOrders(ctx, q) };
    });
    a.get('/orders/unpaid', async () => ({ orders: await unpaidOrders(ctx) }));
    a.post('/orders/:id/record-payment', { preHandler: role('admin') }, async req => {
      const b = parse(z.object({ receipt: z.string().min(1).max(30), amountMinor: z.number().int().positive() }), req.body);
      return recordPaymentByStaff(ctx, req.admin!.id, id(req), b.receipt, b.amountMinor);
    });
    a.get('/orders/:id', async req => {
      const reveal = (req.query as any)?.reveal === '1';
      return A.orderDetail(ctx, req.admin!, id(req), reveal, req.ip);
    });
    a.post('/orders/:id/retry', async req => { await A.retryFulfilment(ctx, req.admin!, id(req)); return { ok: true }; });
    a.post('/orders/:id/resend', async req => {
      const b = parse(z.object({ by: z.enum(['email', 'sms']), to: z.string().max(200) }).optional(), req.body ?? undefined);
      await A.resendCodes(ctx, req.admin!, id(req), b);
      return { ok: true };
    });
    a.get('/payments/review', async () => ({ payments: await paymentsNeedingReview(ctx), unmatched: await unmatchedPayments(ctx) }));

    // ---- stock
    a.get('/stock', async () => ({ products: await stockOverview(ctx) }));
    a.post('/stock/:productId/codes', { preHandler: role('admin') }, async req => {
      const b = parse(z.object({
        codes: z.array(z.union([z.string(), z.object({ code: z.string(), pin: z.string().optional(), serial: z.string().optional(), expiresOn: z.string().optional() })])).min(1).max(5000),
        supplier: z.string().max(100).optional(), unitCostCents: z.number().int().min(0).optional(), note: z.string().max(500).optional()
      }), req.body);
      return uploadCodes(ctx, req.admin!.id, id(req, 'productId'), b.codes.map(c => typeof c === 'string' ? { code: c } : c), b);
    });
    a.post('/stock/codes/:id/void', { preHandler: role('admin') }, async req => {
      const b = parse(z.object({ reason: z.string().min(1).max(300) }), req.body);
      await voidCode(ctx, req.admin!.id, id(req), b.reason);
      return { ok: true };
    });
    a.put('/stock/:productId/eta', { preHandler: role('admin') }, async req => {
      const b = parse(z.object({ eta: z.string().nullable() }), req.body);
      await setRestockEta(ctx, req.admin!.id, id(req, 'productId'), b.eta);
      return { ok: true };
    });

    // ---- settings & catalog
    a.get('/settings', async () => getSettings(ctx.db));
    a.patch('/settings', async req => {
      const b = parse(z.object({
        usdEtbRate: z.number().positive().max(100000).optional(), vatRate: z.number().min(0).max(0.99).optional(),
        sellerName: z.string().min(1).max(60).optional(), lowStockThreshold: z.number().int().min(0).optional(),
        autoFulfil: z.boolean().optional(), maxQtyPerLine: z.number().int().min(1).max(100).optional(),
        paymentTimeoutSecs: z.number().int().min(60).max(86400).optional(), defaultRestockDays: z.number().int().min(1).max(365).optional(),
        support: z.record(z.string(), z.string().max(200)).optional()
      }), req.body);
      return A.updateSettings(ctx, req.admin!, b);
    });
    a.put('/brands/:brandId', async req => {
      const brandId = parse(z.string().regex(/^[a-z0-9-]{2,40}$/), (req.params as any).brandId);
      const b = parse(z.object({
        name: z.string().min(1).max(40).optional(), label: z.string().max(24).nullable().optional(), mark: z.string().min(1).max(24).optional(),
        category: z.enum(['gaming', 'apps', 'video', 'music', 'telecom', 'card']).optional(),
        color1: hex.optional(), color2: hex.optional(), ink: hex.optional(), tile: hex.optional(), tileInk: hex.optional(),
        style: z.record(z.string(), z.unknown()).optional(), logoUrl: z.string().max(500).nullable().optional(),
        cardImageUrl: z.string().max(500).nullable().optional(), bannerUrl: z.string().max(500).nullable().optional(),
        description: z.record(z.string(), z.string()).optional(), redeemInfo: z.record(z.string(), z.string()).optional(),
        isActive: z.boolean().optional(), sortOrder: z.number().int().optional(),
        valuesUsd: z.array(z.number().positive().max(10000)).max(20).optional()
      }), req.body);
      const { valuesUsd, ...patch } = b;
      return A.upsertBrand(ctx, req.admin!, brandId, patch, valuesUsd);
    });
    a.put('/brands/:brandId/media/:kind', { bodyLimit: 3 * 1024 * 1024 }, async req => {
      const p = parse(z.object({ brandId: z.string().regex(/^[a-z0-9-]{2,40}$/), kind: z.enum(MEDIA_KINDS) }), req.params);
      const b = parse(z.object({ dataUrl: z.string().max(2_100_000) }), req.body);
      return setBrandMedia(ctx, req.admin!, p.brandId, p.kind, b.dataUrl);
    });
    a.delete('/brands/:brandId/media/:kind', async req => {
      const p = parse(z.object({ brandId: z.string().regex(/^[a-z0-9-]{2,40}$/), kind: z.enum(MEDIA_KINDS) }), req.params);
      return removeBrandMedia(ctx, req.admin!, p.brandId, p.kind);
    });
    a.patch('/products/:id', async req => {
      const b = parse(z.object({ isActive: z.boolean().optional(), priceOverrideMinor: z.number().int().positive().nullable().optional() }), req.body);
      return A.updateProduct(ctx, req.admin!, id(req), b);
    });
    a.put('/home', async req => {
      const b = parse(z.object({
        banners: z.array(z.object({ brandId: z.string(), title: z.string().max(30).nullish(), accent: hex.nullish(), active: z.boolean().optional() })).max(30).optional(),
        popular: z.array(z.string()).max(50).optional()
      }), req.body);
      await A.setHome(ctx, req.admin!, b);
      return { ok: true };
    });

    // ---- providers (Wupex)
    a.get('/providers', async () => ({ providers: await A.listProviders(ctx) }));
    a.put('/providers/:providerId', async req => {
      const pid = parse(z.string().regex(/^[a-z0-9-]{2,40}$/), (req.params as any).providerId);
      const b = parse(z.object({
        name: z.string().max(60).optional(), adapter: z.enum(['wupex', 'reloadly', 'mock']).optional(),
        environment: z.enum(['sandbox', 'live']).optional(), baseUrl: z.string().url().optional(), isActive: z.boolean().optional(),
        lowBalanceCents: z.number().int().min(0).optional(), buyRate: z.number().positive().optional(), priority: z.number().int().optional(),
        config: z.record(z.string(), z.unknown()).optional()
      }), req.body);
      return A.upsertProvider(ctx, req.admin!, pid, b);
    });
    a.post('/providers/:providerId/sync', async req => A.syncProvider(ctx, req.admin!, String((req.params as any).providerId)));
    a.put('/products/:id/sources/:providerId', async req => {
      const b = parse(z.object({ externalProductId: z.string().min(1).max(200), unitCostCents: z.number().int().min(0), priority: z.number().int().optional() }), req.body);
      await A.mapProductSource(ctx, req.admin!, id(req), String((req.params as any).providerId), b.externalProductId, b.unitCostCents, b.priority);
      return { ok: true };
    });
    a.delete('/products/:id/sources/:providerId', async req => {
      await A.unmapProductSource(ctx, req.admin!, id(req), String((req.params as any).providerId));
      return { ok: true };
    });
    a.get('/providers/:providerId/products', async req => ({ products: await A.providerProducts(ctx, String((req.params as any).providerId)) }));
    a.post('/providers/:providerId/automap', async req => {
      A.requireRole(req.admin!, 'admin');
      const pid = String((req.params as any).providerId);
      const b = parse(z.object({ apply: z.boolean().default(false), addValues: z.boolean().default(false) }), req.body ?? {});
      // adding the provider's card values changes the catalogue: only together with apply
      const values = b.apply && b.addValues ? await addProviderValues(ctx, req.admin!.id, pid) : null;
      const rows = await suggestMappings(ctx, pid);
      return { suggestions: rows, saved: b.apply ? await applyMappings(ctx, req.admin!.id, pid, rows) : 0, ...(values ? { addedValues: values.added, brandsNotCarried: values.brandsNotCarried } : {}) };
    });
    a.get('/providers/log', async req => ({ calls: await A.providerLog(ctx, (req.query as any)?.provider) }));

    // ---- support
    a.get('/tickets', async req => ({ tickets: await listTicketsForStaff(ctx, (req.query as any)?.status) }));
    a.post('/tickets/:id/reply', { preHandler: role('support') }, async req => {
      const b = parse(z.object({ text: z.string().min(1).max(4000), close: z.boolean().optional() }), req.body);
      await staffReply(ctx, req.admin!.id, id(req), b.text, b.close);
      return { ok: true };
    });

    a.post('/tickets/:id/status', async req => {
      const b = parse(z.object({ status: z.enum(['open', 'answered', 'closed']) }), req.body);
      await A.setTicketStatus(ctx, req.admin!, id(req), b.status);
      return { ok: true };
    });

    a.get('/audit', { preHandler: role('admin') }, async () => ({ entries: await A.auditLog(ctx) }));
  });
}
