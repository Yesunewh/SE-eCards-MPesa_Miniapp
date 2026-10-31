import type { Ctx } from '../context.js';
import { many } from '../db/pool.js';
import { notFound } from '../lib/util.js';
import { getSettings, productViews } from './catalog.js';

export async function listWishlist(ctx: Ctx, customerId: string) {
  const s = await getSettings(ctx.db);
  const rows = await many(ctx.db, `SELECT product_id, was_out_of_stock, created_at FROM wishlist_items WHERE customer_id = $1 ORDER BY created_at DESC`, [customerId]);
  if (!rows.length) return [];
  const views = new Map((await productViews(ctx.db, s, 'p.id = ANY($1)', [rows.map(r => r.product_id)])).map(v => [v.id, v]));
  return rows.filter(r => views.has(r.product_id)).map(r => ({ ...views.get(r.product_id)!, savedAt: r.created_at, wasOutOfStock: r.was_out_of_stock }));
}

export async function addToWishlist(ctx: Ctx, customerId: string, productId: string) {
  const s = await getSettings(ctx.db);
  const [p] = await productViews(ctx.db, s, 'p.id = $1 AND p.is_active', [productId]);
  if (!p) throw notFound('product_not_found');
  await ctx.db.query(`INSERT INTO wishlist_items (customer_id, product_id, was_out_of_stock) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [customerId, productId, p.availability === 'out_of_stock']);
}

export async function removeFromWishlist(ctx: Ctx, customerId: string, productId: string) {
  await ctx.db.query(`DELETE FROM wishlist_items WHERE customer_id = $1 AND product_id = $2`, [customerId, productId]);
}
