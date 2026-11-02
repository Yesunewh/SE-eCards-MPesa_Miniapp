import type { Ctx } from '../context.js';
import type { Queryable } from '../db/pool.js';
import { many, maybeOne, one, withTx } from '../db/pool.js';
import { hashPassword, hashToken, newToken, verifyPassword } from '../lib/crypto.js';
import { AppError, badRequest, notFound } from '../lib/util.js';
import { enqueue } from './jobs.js';
import { getOrder } from './orders.js';

export type Role = 'owner' | 'admin' | 'support' | 'viewer';
export interface Admin { id: string; email: string; name: string; role: Role }
const RANK: Record<Role, number> = { viewer: 0, support: 1, admin: 2, owner: 3 };
export const can = (a: Admin, need: Role) => RANK[a.role] >= RANK[need];
export function requireRole(a: Admin, need: Role) { if (!can(a, need)) throw new AppError(403, 'forbidden'); }

const SESSION_HOURS = 12, MAX_FAILS = 5, LOCK_MINUTES = 15;

export async function createAdmin(q: Queryable, email: string, name: string, password: string, role: Role) {
  if (password.length < 10) throw badRequest('weak_password', 'Use at least 10 characters');
  return one<Admin>(q, `INSERT INTO admin_users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role`,
    [email.trim().toLowerCase(), name, await hashPassword(password), role]);
}

export async function adminLogin(ctx: Ctx, email: string, password: string, ip?: string) {
  const a = await maybeOne(ctx.db, `SELECT * FROM admin_users WHERE lower(email) = lower($1)`, [String(email).trim()]);
  const fail = new AppError(401, 'bad_credentials', 'Wrong email or password');
  if (!a || !a.is_active) { await verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA'); throw fail; }   // same timing either way
  if (a.locked_until && new Date(a.locked_until) > new Date()) throw new AppError(429, 'account_locked', 'Too many attempts. Try again later.');
  if (!await verifyPassword(password, a.password_hash)) {
    // after MAX_FAILS wrong passwords in a row: locked for LOCK_MINUTES, counter starts again
    await ctx.db.query(`UPDATE admin_users SET
      locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
      failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END WHERE id = $1`, [a.id, MAX_FAILS, LOCK_MINUTES]);
    throw fail;
  }
  await ctx.db.query(`UPDATE admin_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [a.id]);
  const token = newToken();
  await ctx.db.query(`INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at, ip) VALUES ($1,$2, now() + make_interval(hours => $3), $4)`,
    [a.id, hashToken(token), SESSION_HOURS, ip ?? null]);
  await audit(ctx.db, a.id, 'admin.login', 'admin_user', a.id, {}, ip);
  return { token, admin: { id: a.id, email: a.email, name: a.name, role: a.role } as Admin };
}

export async function adminFromToken(ctx: Ctx, token: string): Promise<Admin | null> {
  return maybeOne<Admin>(ctx.db, `
    SELECT a.id, a.email, a.name, a.role FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_user_id
    WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND a.is_active`, [hashToken(token)]);
}

export async function adminLogout(ctx: Ctx, token: string) {
  await ctx.db.query(`UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1`, [hashToken(token)]);
}

export async function audit(q: Queryable, adminId: string | null, action: string, entityType: string, entityId: string | null, details: object, ip?: string) {
  await q.query(`INSERT INTO audit_log (admin_user_id, action, entity_type, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [adminId, action, entityType, entityId, details, ip ?? null]);
}

/** Overview numbers for the admin home. */
export async function dashboard(ctx: Ctx) {
  return one(ctx.db, `
    SELECT
      (SELECT count(*)::int FROM orders WHERE paid_at >= date_trunc('day', now())) AS orders_today,
      (SELECT COALESCE(sum(total_minor), 0) FROM orders WHERE paid_at >= date_trunc('day', now())) AS revenue_today_minor,
      (SELECT COALESCE(sum(total_minor), 0) FROM orders WHERE paid_at >= now() - interval '30 days') AS revenue_30d_minor,
      (SELECT count(*)::int FROM orders WHERE status = 'awaiting_stock') AS orders_awaiting_stock,
      (SELECT COALESCE(sum(quantity - delivered_quantity), 0)::int FROM order_items WHERE status = 'waiting') AS cards_owed,
      (SELECT count(*)::int FROM support_tickets WHERE status = 'open') AS tickets_open,
      (SELECT count(*)::int FROM product_stock ps JOIN products p ON p.id = ps.product_id
         WHERE p.is_active AND ps.codes_available <= (SELECT low_stock_threshold FROM app_settings)) AS products_low_or_out,
      (SELECT count(*)::int FROM provider_orders WHERE status = 'unknown') AS provider_orders_unresolved,
      (SELECT count(*)::int FROM provider_orders WHERE status = 'partial') AS provider_preorders_open,
      (SELECT count(*)::int FROM payments WHERE status = 'failed' AND (result_desc LIKE 'AMOUNT MISMATCH%' OR result_desc LIKE 'DUPLICATE PAYMENT%')) AS payments_needing_review,
      (SELECT count(*)::int FROM jobs WHERE status = 'dead') AS jobs_dead`);
}

export async function searchOrders(ctx: Ctx, f: { q?: string; status?: string; limit?: number; offset?: number }) {
  const q = f.q?.trim() || null;
  return many(ctx.db, `
    SELECT o.id, o.reference, o.status, o.total_minor, o.created_at, o.paid_at, o.deliver_by, o.deliver_to,
           c.name AS customer_name, c.msisdn,
           (SELECT receipt_number FROM payments p WHERE p.order_id = o.id AND p.status = 'succeeded') AS receipt,
           (SELECT json_agg(json_build_object('title', i.title, 'quantity', i.quantity, 'delivered', i.delivered_quantity, 'status', i.status) ORDER BY i.line_no)
              FROM order_items i WHERE i.order_id = o.id) AS items
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE ($1::text IS NULL OR o.status = $1)
      AND ($2::text IS NULL OR o.reference ILIKE $2 || '%' OR c.msisdn LIKE '%' || $2 || '%'
           OR EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.receipt_number = $2))
    ORDER BY o.created_at DESC LIMIT $3 OFFSET $4`, [f.status ?? null, q, Math.min(f.limit ?? 50, 200), f.offset ?? 0]);
}

/**
 * Paid orders with their lines, for the admin panel's orders and pre-orders pages.
 * Codes are masked here; the full code needs orderDetail(reveal) and is audited.
 */
export async function ordersForPanel(ctx: Ctx, limit = 300) {
  return many(ctx.db, `
    SELECT o.id, o.reference, o.status, o.total_minor, o.created_at, o.paid_at, o.deliver_by, o.deliver_to,
           c.name AS customer_name, c.msisdn,
           (SELECT receipt_number FROM payments p WHERE p.order_id = o.id AND p.status = 'succeeded') AS receipt,
           (SELECT json_agg(json_build_object(
               'id', i.id, 'brandId', i.brand_id, 'faceValueUsd', i.face_value_cents / 100.0, 'quantity', i.quantity,
               'deliveredQuantity', i.delivered_quantity, 'unitPriceMinor', i.unit_price_minor, 'status', i.status,
               'eta', i.eta, 'deliveredAt', i.delivered_at,
               'codes', (SELECT COALESCE(json_agg('••••' || g.code_last4 ORDER BY g.sold_at), '[]') FROM gift_codes g WHERE g.order_item_id = i.id),
               'provider', (SELECT po.provider_id FROM provider_orders po WHERE po.order_item_id = i.id AND po.status = 'succeeded' LIMIT 1)
             ) ORDER BY i.line_no) FROM order_items i WHERE i.order_id = o.id) AS items
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.status IN ('paid','awaiting_stock','completed')
    ORDER BY o.created_at DESC LIMIT $1`, [Math.min(limit, 1000)]);
}

export async function setTicketStatus(ctx: Ctx, admin: Admin, ticketId: string, status: 'open' | 'answered' | 'closed') {
  requireRole(admin, 'support');
  const r = await ctx.db.query(`UPDATE support_tickets SET status = $2, staff_seen_at = now() WHERE id = $1`, [ticketId, status]);
  if (!r.rowCount) throw notFound('ticket_not_found');
  await audit(ctx.db, admin.id, 'ticket.status', 'support_ticket', ticketId, { status });
}

/** Order detail for staff. Codes are masked unless revealCodes (admin+ only, written to the audit log). */
export async function orderDetail(ctx: Ctx, admin: Admin, orderId: string, revealCodes = false, ip?: string) {
  if (revealCodes) requireRole(admin, 'admin');
  const o = await getOrder(ctx, null, orderId, { withCodes: true });
  const payments = await many(ctx.db, `SELECT id, status, amount_minor, receipt_number, result_code, result_desc, created_at, completed_at FROM payments WHERE order_id = $1 ORDER BY created_at`, [o.id]);
  const providerOrders = await many(ctx.db, `
    SELECT po.id, po.provider_id, po.custom_identifier, po.status, po.quantity, po.total_cost_cents, po.external_transaction_id, po.last_error, po.created_at
    FROM provider_orders po JOIN order_items i ON i.id = po.order_item_id WHERE i.order_id = $1 ORDER BY po.created_at`, [o.id]);
  const notifications = await many(ctx.db, `SELECT id, channel, recipient, template, status, attempts, last_error, sent_at FROM notifications WHERE order_id = $1 ORDER BY created_at`, [o.id]);
  if (revealCodes) await audit(ctx.db, admin.id, 'order.reveal_codes', 'order', o.id, {}, ip);
  const items = o.items.map(it => ({ ...it, codes: it.codes.map(c => ({ ...c, code: revealCodes ? c.code : '••••' + c.code.replace(/[\s-]/g, '').slice(-4), pin: revealCodes ? c.pin : c.pin ? '••••' : null })) }));
  return { ...o, items, payments, providerOrders, notifications };
}

/** Re-send the codes email/SMS for an order (e.g. customer typed the wrong address, then fixed it). */
export async function resendCodes(ctx: Ctx, admin: Admin, orderId: string, to?: { by: 'email' | 'sms'; to: string }) {
  requireRole(admin, 'support');
  const o = await one(ctx.db, `SELECT * FROM orders WHERE id = $1`, [orderId]);
  const codeIds = (await many(ctx.db, `SELECT g.id FROM gift_codes g JOIN order_items i ON i.id = g.order_item_id WHERE i.order_id = $1`, [orderId])).map(r => r.id);
  if (!codeIds.length) throw badRequest('no_codes_yet');
  const { queueNotification } = await import('./notifications.js');
  await queueNotification(ctx.db, { customerId: o.customer_id, orderId, channel: to?.by ?? o.deliver_by, to: to?.to ?? o.deliver_to, template: 'codes_delivered', params: { reference: o.reference, codeIds, lang: o.lang } });
  await audit(ctx.db, admin.id, 'order.resend_codes', 'order', orderId, { to: to?.to ?? o.deliver_to });
}

export async function retryFulfilment(ctx: Ctx, admin: Admin, orderId: string) {
  requireRole(admin, 'admin');
  await enqueue(ctx.db, 'fulfil_order', { orderId }, { dedupeKey: `fulfil:${orderId}` });
  await audit(ctx.db, admin.id, 'order.retry_fulfilment', 'order', orderId, {});
}

// ---------------------------------------------------------------- settings & catalog

export interface SettingsPatch {
  usdEtbRate?: number; vatRate?: number; sellerName?: string; lowStockThreshold?: number; autoFulfil?: boolean;
  maxQtyPerLine?: number; paymentTimeoutSecs?: number; defaultRestockDays?: number; support?: Record<string, string>;
}

export async function updateSettings(ctx: Ctx, admin: Admin, p: SettingsPatch) {
  requireRole(admin, 'admin');
  return withTx(ctx.db, async tx => {
    const before = await one(tx, `SELECT * FROM app_settings WHERE id = 1 FOR UPDATE`);
    const after = await one(tx, `
      UPDATE app_settings SET
        usd_etb_rate = COALESCE($1, usd_etb_rate), vat_rate = COALESCE($2, vat_rate), seller_name = COALESCE($3, seller_name),
        low_stock_threshold = COALESCE($4, low_stock_threshold), auto_fulfil = COALESCE($5, auto_fulfil),
        max_qty_per_line = COALESCE($6, max_qty_per_line), payment_timeout_secs = COALESCE($7, payment_timeout_secs),
        default_restock_days = COALESCE($8, default_restock_days), support = COALESCE($9, support), updated_by = $10
      WHERE id = 1 RETURNING *`,
      [p.usdEtbRate ?? null, p.vatRate ?? null, p.sellerName ?? null, p.lowStockThreshold ?? null, p.autoFulfil ?? null,
       p.maxQtyPerLine ?? null, p.paymentTimeoutSecs ?? null, p.defaultRestockDays ?? null, p.support ?? null, admin.id]);
    await audit(tx, admin.id, 'settings.update', 'app_settings', '1', {
      before: { rate: before.usd_etb_rate, vat: before.vat_rate }, after: { rate: after.usd_etb_rate, vat: after.vat_rate }, patch: p });
    return after;
  });
}

const BRAND_FIELDS: Record<string, string> = {
  name: 'name', label: 'label', mark: 'mark', category: 'category', color1: 'color1', color2: 'color2', ink: 'ink',
  tile: 'tile', tileInk: 'tile_ink', style: 'style', logoUrl: 'logo_url', cardImageUrl: 'card_image_url', bannerUrl: 'banner_url',
  description: 'description', redeemInfo: 'redeem_info', isActive: 'is_active', sortOrder: 'sort_order'
};

/** Create (if id is new) or update a brand. New brands get products in the given USD values. */
export async function upsertBrand(ctx: Ctx, admin: Admin, id: string, patch: Record<string, unknown>, valuesUsd?: number[]) {
  requireRole(admin, 'admin');
  return withTx(ctx.db, async tx => {
    const exists = await maybeOne(tx, `SELECT id FROM brands WHERE id = $1 FOR UPDATE`, [id]);
    const cols = Object.keys(patch).filter(k => k in BRAND_FIELDS);
    if (!exists) {
      const need = ['name', 'mark', 'category', 'color1', 'color2', 'ink'];
      for (const k of need) if (patch[k] === undefined) throw badRequest('missing_field', `${k} is required for a new brand`);
      const v = { tile: patch.color1, tileInk: patch.ink, ...patch };
      const keys = Object.keys(v).filter(k => k in BRAND_FIELDS);
      await tx.query(`INSERT INTO brands (id, ${keys.map(k => BRAND_FIELDS[k]).join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})`,
        [id, ...keys.map(k => (v as any)[k])]);
    } else if (cols.length) {
      await tx.query(`UPDATE brands SET ${cols.map((k, i) => `${BRAND_FIELDS[k]} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...cols.map(k => patch[k])]);
    }
    for (const usd of valuesUsd ?? []) {
      if (!(usd > 0)) throw badRequest('bad_value');
      await tx.query(`INSERT INTO products (brand_id, face_value_cents) VALUES ($1,$2) ON CONFLICT (brand_id, face_value_cents, face_currency, region) DO UPDATE SET is_active = true`,
        [id, Math.round(usd * 100)]);
    }
    await audit(tx, admin.id, exists ? 'brand.update' : 'brand.create', 'brand', id, { patch, valuesUsd });
    return one(tx, `SELECT * FROM brands WHERE id = $1`, [id]);
  });
}

export async function updateProduct(ctx: Ctx, admin: Admin, productId: string, p: { isActive?: boolean; priceOverrideMinor?: number | null }) {
  requireRole(admin, 'admin');
  const r = await maybeOne(ctx.db, `
    UPDATE products SET is_active = COALESCE($2, is_active),
      price_override_minor = CASE WHEN $3 THEN $4 ELSE price_override_minor END
    WHERE id = $1 RETURNING *`, [productId, p.isActive ?? null, p.priceOverrideMinor !== undefined, p.priceOverrideMinor ?? null]);
  if (!r) throw notFound('product_not_found');
  await audit(ctx.db, admin.id, 'product.update', 'product', productId, p);
  return r;
}

/** Replace the home screen layout: banners, popular brands. */
export async function setHome(ctx: Ctx, admin: Admin, h: { banners?: { brandId: string; title?: string | null; accent?: string | null; active?: boolean }[]; popular?: string[] }) {
  requireRole(admin, 'admin');
  await withTx(ctx.db, async tx => {
    if (h.banners) {
      await tx.query(`DELETE FROM home_banners`);
      for (const [i, b] of h.banners.entries()) {
        await tx.query(`INSERT INTO home_banners (brand_id, title, accent, is_active, position) VALUES ($1,$2,$3,$4,$5)`, [b.brandId, b.title ?? null, b.accent ?? null, b.active ?? true, i]);
      }
    }
    if (h.popular) {
      await tx.query(`DELETE FROM home_popular_brands`);
      for (const [i, id] of h.popular.entries()) await tx.query(`INSERT INTO home_popular_brands (brand_id, position) VALUES ($1,$2)`, [id, i]);
    }
    await audit(tx, admin.id, 'home.update', 'home', null, h);
  });
}

// ---------------------------------------------------------------- providers

export async function listProviders(ctx: Ctx) {
  return many(ctx.db, `
    SELECT p.id, p.name, p.adapter, p.environment, p.base_url, p.is_active, p.status, p.status_message, p.balance_cents,
           p.balance_currency, p.balance_checked_at, p.low_balance_cents, p.buy_rate, p.priority,
           (SELECT count(*)::int FROM product_sources s WHERE s.provider_id = p.id AND s.is_active) AS products_mapped
    FROM providers p ORDER BY p.priority, p.id`);
}

export async function upsertProvider(ctx: Ctx, admin: Admin, id: string, p: {
  name?: string; adapter?: 'wupex' | 'reloadly' | 'mock'; environment?: 'sandbox' | 'live'; baseUrl?: string;
  isActive?: boolean; lowBalanceCents?: number; buyRate?: number; priority?: number; config?: Record<string, unknown>;
}) {
  requireRole(admin, 'owner');
  const r = await one(ctx.db, `
    INSERT INTO providers (id, name, adapter, environment, base_url, is_active, low_balance_cents, buy_rate, priority, config)
    VALUES ($1, COALESCE($2::text, $1), COALESCE($3::text, 'wupex'), COALESCE($4::text, 'sandbox'), $5, COALESCE($6::boolean, false),
            COALESCE($7::bigint, 0), $8, COALESCE($9::int, 100), COALESCE($10::jsonb, '{}'::jsonb))
    ON CONFLICT (id) DO UPDATE SET
      name = COALESCE($2, providers.name), adapter = COALESCE($3, providers.adapter), environment = COALESCE($4, providers.environment),
      base_url = COALESCE($5, providers.base_url), is_active = COALESCE($6, providers.is_active),
      low_balance_cents = COALESCE($7, providers.low_balance_cents), buy_rate = COALESCE($8, providers.buy_rate),
      priority = COALESCE($9::int, providers.priority), config = COALESCE($10::jsonb, providers.config)
    RETURNING id`, [id, p.name ?? null, p.adapter ?? null, p.environment ?? null, p.baseUrl ?? null, p.isActive ?? null,
      p.lowBalanceCents ?? null, p.buyRate ?? null, p.priority ?? null, p.config ?? null]);
  await audit(ctx.db, admin.id, 'provider.upsert', 'provider', id, p);
  return r;
}

/** Calls the provider for its balance and catalog; marks it ok/error. */
export async function syncProvider(ctx: Ctx, admin: Admin | null, id: string) {
  if (admin) requireRole(admin, 'admin');
  const pr = await maybeOne(ctx.db, `SELECT * FROM providers WHERE id = $1`, [id]);
  if (!pr) throw notFound('provider_not_found');
  const adapter = ctx.providerFor(pr.adapter);
  if (!adapter) throw badRequest('adapter_not_configured', `No ${pr.adapter} adapter is configured on this server`);
  try {
    const bal = await adapter.getBalance();
    const items = await adapter.listProducts();
    await withTx(ctx.db, async tx => {
      for (const it of items) {
        await tx.query(`
          INSERT INTO provider_products (provider_id, external_id, name, brand_name, country, currency, denomination_type,
                                         denominations_cents, min_cents, max_cents, discount_pct, fee_cents, is_available, raw, price_cents, synced_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
          ON CONFLICT (provider_id, external_id) DO UPDATE SET name = EXCLUDED.name, brand_name = EXCLUDED.brand_name,
            country = EXCLUDED.country, currency = EXCLUDED.currency, denomination_type = EXCLUDED.denomination_type,
            denominations_cents = EXCLUDED.denominations_cents, min_cents = EXCLUDED.min_cents, max_cents = EXCLUDED.max_cents,
            discount_pct = EXCLUDED.discount_pct, fee_cents = EXCLUDED.fee_cents, is_available = EXCLUDED.is_available,
            raw = EXCLUDED.raw, price_cents = EXCLUDED.price_cents, synced_at = now()`,
          [id, it.externalId, it.name, it.brandName ?? null, it.country ?? null, it.currency, it.type, it.denominationsCents ?? [],
           it.minCents ?? null, it.maxCents ?? null, it.discountPct ?? null, it.feeCents ?? null, it.available, JSON.stringify(it.raw ?? {}), it.priceCents ?? null]);
      }
      // products the provider no longer lists are marked unavailable
      if (items.length) {
        await tx.query(`UPDATE provider_products SET is_available = false WHERE provider_id = $1 AND NOT (external_id = ANY($2))`, [id, items.map(i => i.externalId)]);
      }
      await tx.query(`UPDATE providers SET status = 'ok', status_message = NULL, balance_cents = $2, balance_currency = $3, balance_checked_at = now() WHERE id = $1`,
        [id, bal.balanceCents, bal.currency]);
    });
    return { ok: true, balanceCents: bal.balanceCents, products: items.length };
  } catch (e) {
    await ctx.db.query(`UPDATE providers SET status = 'error', status_message = $2 WHERE id = $1`, [id, (e as Error).message.slice(0, 500)]);
    return { ok: false, error: (e as Error).message };
  }
}

/** Map one of our products to a provider product (the demo's "sell" mapping). */
export async function mapProductSource(ctx: Ctx, admin: Admin, productId: string, providerId: string, externalProductId: string, unitCostCents: number, priority = 100) {
  requireRole(admin, 'admin');
  const pp = await maybeOne(ctx.db, `SELECT id FROM provider_products WHERE provider_id = $1 AND external_id = $2`, [providerId, externalProductId]);
  await ctx.db.query(`
    INSERT INTO product_sources (product_id, provider_id, provider_product_id, external_product_id, unit_cost_cents, priority)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (product_id, provider_id) DO UPDATE SET provider_product_id = EXCLUDED.provider_product_id,
      external_product_id = EXCLUDED.external_product_id, unit_cost_cents = EXCLUDED.unit_cost_cents, priority = EXCLUDED.priority, is_active = true`,
    [productId, providerId, pp?.id ?? null, externalProductId, unitCostCents, priority]);
  await audit(ctx.db, admin.id, 'provider.map_product', 'product', productId, { providerId, externalProductId, unitCostCents });
}

export async function providerLog(ctx: Ctx, providerId?: string, limit = 100) {
  return many(ctx.db, `SELECT * FROM provider_api_calls WHERE ($1::text IS NULL OR provider_id = $1) ORDER BY id DESC LIMIT $2`, [providerId ?? null, Math.min(limit, 500)]);
}

export async function auditLog(ctx: Ctx, limit = 100) {
  return many(ctx.db, `SELECT l.*, a.email AS admin_email FROM audit_log l LEFT JOIN admin_users a ON a.id = l.admin_user_id ORDER BY l.id DESC LIMIT $1`, [Math.min(limit, 500)]);
}
