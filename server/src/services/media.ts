/**
 * Brand pictures uploaded in the admin panel. Stored in the database (brand_media), served by the API at
 * /media/brands/<brand>/<kind>?v=<version>. Only PNG, JPEG, WebP and GIF are accepted (no SVG: it can carry scripts),
 * and the bytes must really be that kind of image.
 */
import type { Ctx } from '../context.js';
import { maybeOne, withTx } from '../db/pool.js';
import { badRequest, notFound } from '../lib/util.js';
import type { Admin } from './admin.js';
import { audit, requireRole } from './admin.js';

export const MEDIA_KINDS = ['logo', 'card', 'banner'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
const COLUMN: Record<MediaKind, string> = { logo: 'logo_url', card: 'card_image_url', banner: 'banner_url' };
const MAX_BYTES = 1_500_000;

/** What the bytes are, from their first bytes (never trust the declared type). */
function sniff(b: Buffer): string | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 6 && /^GIF8[79]a$/.test(b.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}

export async function setBrandMedia(ctx: Ctx, admin: Admin, brandId: string, kind: MediaKind, dataUrl: string) {
  requireRole(admin, 'admin');
  const m = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw badRequest('image_invalid', 'Send the picture as a base64 data URL');
  const bytes = Buffer.from(m[2]!, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) throw badRequest('image_too_large', 'Pictures can be at most 1.5 MB');
  const type = sniff(bytes);
  if (!type) throw badRequest('image_type', 'Use a PNG, JPEG, WebP or GIF picture');
  return withTx(ctx.db, async tx => {
    const b = await maybeOne(tx, `SELECT id FROM brands WHERE id = $1 FOR UPDATE`, [brandId]);
    if (!b) throw notFound('brand_not_found');
    await tx.query(`
      INSERT INTO brand_media (brand_id, kind, content_type, data, updated_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (brand_id, kind) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data,
        updated_by = EXCLUDED.updated_by, updated_at = now()`, [brandId, kind, type, bytes, admin.id]);
    const url = `/media/brands/${brandId}/${kind}?v=${Date.now().toString(36)}`;
    await tx.query(`UPDATE brands SET ${COLUMN[kind]} = $2 WHERE id = $1`, [brandId, url]);
    await audit(tx, admin.id, 'brand.media_set', 'brand', brandId, { kind, type, bytes: bytes.length });
    return { url, type, bytes: bytes.length };
  });
}

export async function removeBrandMedia(ctx: Ctx, admin: Admin, brandId: string, kind: MediaKind) {
  requireRole(admin, 'admin');
  await withTx(ctx.db, async tx => {
    await tx.query(`DELETE FROM brand_media WHERE brand_id = $1 AND kind = $2`, [brandId, kind]);
    await tx.query(`UPDATE brands SET ${COLUMN[kind]} = NULL WHERE id = $1`, [brandId]);
    await audit(tx, admin.id, 'brand.media_removed', 'brand', brandId, { kind });
  });
  return { ok: true };
}

export async function getBrandMedia(ctx: Ctx, brandId: string, kind: MediaKind) {
  return maybeOne<{ content_type: string; data: Buffer; updated_at: Date }>(ctx.db,
    `SELECT content_type, data, updated_at FROM brand_media WHERE brand_id = $1 AND kind = $2`, [brandId, kind]);
}
