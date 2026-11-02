import type { Queryable } from '../db/pool.js';
import { one, many } from '../db/pool.js';
import { addDays, isoDate, priceMinor, titleOf } from '../lib/util.js';

export interface Settings {
  usd_etb_rate: number; vat_rate: number; seller_name: string; low_stock_threshold: number; auto_fulfil: boolean;
  max_qty_per_line: number; max_order_total_minor: number; payment_timeout_secs: number; default_restock_days: number;
  support: Record<string, string>;
}

export const getSettings = (q: Queryable) => one<Settings>(q, `SELECT * FROM app_settings WHERE id = 1`);

export type Availability = 'in_stock' | 'low' | 'out_of_stock';

export interface ProductView {
  id: string; brandId: string; faceValueUsd: number; title: string;
  priceMinor: number; vatMinor: number;
  availability: Availability;
  /** Most cards one order line can take now; out of stock lines can still be pre-ordered up to the line limit. */
  maxQty: number;
  restockEta: string | null;
}

/**
 * Products with price and availability. Availability = codes on hand + a ready provider that can afford one card,
 * the same rule the app shows (stockOf() in index.html).
 */
export async function productViews(q: Queryable, s: Settings, where = 'TRUE', params: unknown[] = []): Promise<ProductView[]> {
  const rows = await many(q, `
    SELECT p.id, p.brand_id, p.face_value_cents, p.price_override_minor, p.restock_eta, b.name AS brand_name,
           ps.codes_available,
           EXISTS (
             SELECT 1 FROM product_sources src JOIN providers pr ON pr.id = src.provider_id
             WHERE src.product_id = p.id AND src.is_active AND pr.is_active AND pr.status = 'ok'
               AND (pr.balance_cents IS NULL OR pr.balance_cents >= src.unit_cost_cents)
           ) AS provider_ready
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    JOIN product_stock ps ON ps.product_id = p.id
    WHERE ${where}
    ORDER BY b.sort_order, b.id, p.face_value_cents`, params);
  const fallbackEta = isoDate(addDays(new Date(), s.default_restock_days));
  return rows.map(r => {
    const price = r.price_override_minor ?? priceMinor(r.face_value_cents, s.usd_etb_rate);
    const onHand: number = r.codes_available;
    const availability: Availability = r.provider_ready || onHand > s.low_stock_threshold ? 'in_stock' : onHand > 0 ? 'low' : 'out_of_stock';
    const out = availability === 'out_of_stock';
    return {
      id: r.id, brandId: r.brand_id, faceValueUsd: r.face_value_cents / 100, title: titleOf(r.brand_name, r.face_value_cents),
      priceMinor: price, vatMinor: Math.round(price * s.vat_rate / (1 + s.vat_rate)),
      availability,
      maxQty: r.provider_ready || out ? s.max_qty_per_line : Math.min(s.max_qty_per_line, onHand),
      restockEta: out ? (r.restock_eta && r.restock_eta > isoDate(new Date()) ? r.restock_eta : fallbackEta) : null
    };
  });
}

/** Everything the mini app home, brand and product screens need, in one call. */
export async function getCatalog(q: Queryable) {
  const s = await getSettings(q);
  const brands = await many(q, `
    SELECT id, name, label, mark, category, color1, color2, ink, tile, tile_ink, style, logo_url, card_image_url, banner_url,
           description, redeem_info, is_hidden
    FROM brands WHERE is_active ORDER BY sort_order, id`);
  const products = await productViews(q, s, 'p.is_active AND b.is_active');
  const byBrand = new Map<string, ProductView[]>();
  for (const p of products) byBrand.set(p.brandId, [...(byBrand.get(p.brandId) ?? []), p]);
  const live = new Set(brands.filter(b => !b.is_hidden && byBrand.has(b.id)).map(b => b.id));

  const banners = await many(q, `SELECT brand_id, title, accent, is_active FROM home_banners ORDER BY position`);
  const popular = await many(q, `SELECT brand_id FROM home_popular_brands ORDER BY position`);
  const rowItems = await many(q, `SELECT row_key, product_id FROM home_row_items ORDER BY row_key, position`);
  const productIds = new Set(products.map(p => p.id));
  const rows: Record<string, string[]> = {};
  for (const r of rowItems) if (productIds.has(r.product_id)) (rows[r.row_key] ??= []).push(r.product_id);

  return {
    settings: {
      currency: 'ETB', usdEtbRate: s.usd_etb_rate, vatRate: s.vat_rate, seller: s.seller_name,
      maxQtyPerLine: s.max_qty_per_line, lowStockThreshold: s.low_stock_threshold, support: s.support
    },
    brands: brands.map(b => ({
      id: b.id, name: b.name, label: b.label, mark: b.mark, category: b.category, hidden: b.is_hidden,
      colors: { c1: b.color1, c2: b.color2, ink: b.ink, tile: b.tile, tileInk: b.tile_ink },
      style: b.style, logoUrl: b.logo_url, cardImageUrl: b.card_image_url, bannerUrl: b.banner_url,
      description: b.description, redeemInfo: b.redeem_info,
      products: byBrand.get(b.id) ?? []
    })),
    home: {
      banners: banners.filter(x => live.has(x.brand_id)).map(x => ({ brandId: x.brand_id, title: x.title, accent: x.accent, active: x.is_active })),
      popular: popular.map(x => x.brand_id).filter(id => live.has(id)),
      rows: Object.entries(rows).map(([key, items]) => ({ key, productIds: items }))
    }
  };
}
