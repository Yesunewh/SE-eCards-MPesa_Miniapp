import type { Ctx } from '../context.js';
import { many, maybeOne, one, withTx } from '../db/pool.js';
import { last4, normaliseCode } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/util.js';
import { getSettings } from './catalog.js';
import { fulfilWaitingForProduct } from './fulfilment.js';

export interface UploadCode { code: string; pin?: string; serial?: string; expiresOn?: string }

/**
 * Admin uploads codes for one product. Duplicates (already in the database, or repeated in the upload)
 * are skipped and reported, never stored twice. Waiting pre-orders are filled straight after, if auto-fulfil is on.
 */
export async function uploadCodes(ctx: Ctx, adminId: string | null, productId: string,
  codes: UploadCode[], opts: { supplier?: string; unitCostCents?: number; note?: string } = {}) {
  if (!codes.length) throw badRequest('no_codes');
  if (codes.length > 5000) throw badRequest('too_many_codes', 'Upload at most 5000 codes at a time');
  const product = await maybeOne(ctx.db, `SELECT id FROM products WHERE id = $1`, [productId]);
  if (!product) throw notFound('product_not_found');

  const seen = new Set<string>();
  const clean: UploadCode[] = [];
  const rejected: { code: string; reason: string }[] = [];
  for (const c of codes) {
    const norm = normaliseCode(String(c.code ?? ''));
    if (norm.length < 6 || norm.length > 128) { rejected.push({ code: mask(c.code), reason: 'invalid' }); continue; }
    if (seen.has(norm)) { rejected.push({ code: mask(c.code), reason: 'repeated_in_upload' }); continue; }
    if (c.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(c.expiresOn)) { rejected.push({ code: mask(c.code), reason: 'bad_expiry' }); continue; }
    seen.add(norm);
    clean.push({ ...c, code: String(c.code).trim() });
  }

  const result = await withTx(ctx.db, async tx => {
    const batch = await one(tx, `INSERT INTO inventory_batches (product_id, source, supplier, unit_cost_cents, note, created_by)
                                 VALUES ($1,'upload',$2,$3,$4,$5) RETURNING id`,
      [productId, opts.supplier ?? null, opts.unitCostCents ?? null, opts.note ?? null, adminId]);
    let added = 0;
    for (const c of clean) {
      const r = await tx.query(`
        INSERT INTO gift_codes (product_id, batch_id, source, code_enc, pin_enc, serial, key_version, code_hmac, code_last4, expires_on, unit_cost_cents)
        VALUES ($1,$2,'upload',$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (code_hmac) DO NOTHING`,
        [productId, batch.id, ctx.vault.encrypt(c.code), c.pin ? ctx.vault.encrypt(c.pin) : null, c.serial ?? null,
         ctx.vault.keyVersion, ctx.vault.fingerprint(c.code), last4(c.code), c.expiresOn ?? null, opts.unitCostCents ?? null]);
      if (r.rowCount) added++; else rejected.push({ code: mask(c.code), reason: 'already_in_stock' });
    }
    await tx.query(`UPDATE inventory_batches SET code_count = $2 WHERE id = $1`, [batch.id, added]);
    if (added) await tx.query(`UPDATE products SET restock_eta = NULL WHERE id = $1`, [productId]);
    await tx.query(`INSERT INTO audit_log (admin_user_id, action, entity_type, entity_id, details) VALUES ($1,'stock.upload','product',$2,$3)`,
      [adminId, productId, { batchId: batch.id, added, rejected: rejected.length }]);
    return { batchId: batch.id as string, added };
  });

  const s = await getSettings(ctx.db);
  const queuedOrders = result.added && s.auto_fulfil ? await fulfilWaitingForProduct(ctx, productId) : 0;
  return { ...result, rejected, queuedOrders };
}

const mask = (code: unknown) => { const s = String(code ?? ''); return s.length <= 4 ? '****' : '****' + s.slice(-4); };

/** Stock overview for the admin (codes on hand, owed to pre-orders, provider coverage). */
export async function stockOverview(ctx: Ctx) {
  return many(ctx.db, `
    SELECT p.id, p.brand_id, p.face_value_cents / 100 AS face_value_usd, p.is_active, p.restock_eta,
           ps.codes_available, ps.preorders_owed,
           (SELECT count(*)::int FROM gift_codes g WHERE g.product_id = p.id AND g.status = 'sold') AS codes_sold,
           (SELECT array_agg(src.provider_id ORDER BY src.priority) FROM product_sources src WHERE src.product_id = p.id AND src.is_active) AS providers,
           EXISTS (SELECT 1 FROM product_sources src JOIN providers pr ON pr.id = src.provider_id
                   WHERE src.product_id = p.id AND src.is_active AND pr.is_active AND pr.status = 'ok') AS provider_ready
    FROM products p JOIN product_stock ps ON ps.product_id = p.id JOIN brands b ON b.id = p.brand_id
    ORDER BY b.sort_order, p.brand_id, p.face_value_cents`);
}

/** Take a code out of stock (damaged, already used, wrong product). Sold codes cannot be voided here. */
export async function voidCode(ctx: Ctx, adminId: string, codeId: string, reason: string) {
  const r = await ctx.db.query(`UPDATE gift_codes SET status = 'void', voided_reason = $2 WHERE id = $1 AND status = 'available'`, [codeId, reason.slice(0, 300)]);
  if (!r.rowCount) throw badRequest('code_not_available');
  await ctx.db.query(`INSERT INTO audit_log (admin_user_id, action, entity_type, entity_id, details) VALUES ($1,'stock.void','gift_code',$2,$3)`, [adminId, codeId, { reason }]);
}

export async function setRestockEta(ctx: Ctx, adminId: string, productId: string, eta: string | null) {
  if (eta !== null && !/^\d{4}-\d{2}-\d{2}$/.test(eta)) throw badRequest('bad_date');
  const r = await ctx.db.query(`UPDATE products SET restock_eta = $2 WHERE id = $1`, [productId, eta]);
  if (!r.rowCount) throw notFound('product_not_found');
  await ctx.db.query(`UPDATE order_items SET eta = $2 WHERE product_id = $1 AND status = 'waiting' AND $2::date IS NOT NULL`, [productId, eta]);
  await ctx.db.query(`INSERT INTO audit_log (admin_user_id, action, entity_type, entity_id, details) VALUES ($1,'stock.eta','product',$2,$3)`, [adminId, productId, { eta }]);
}
