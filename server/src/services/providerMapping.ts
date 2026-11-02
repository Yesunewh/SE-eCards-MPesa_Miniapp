/**
 * Which provider product delivers which of our cards.
 * After a sync, suggestMappings() pairs each of our products (brand + USD value) with the provider's SKU
 * for the same brand and value, preferring cards for the US, then global ones; applyMappings() saves them
 * as product_sources with the cost price (the provider's price, which already includes its discount).
 */
import type { Ctx } from '../context.js';
import { many, withTx } from '../db/pool.js';
import type { Queryable } from '../db/pool.js';
import { audit } from './admin.js';

/** Words that identify a brand in a provider's SKU or product name. Brands added later match on their name. */
const KEYWORDS: Record<string, string[]> = {
  netflix: ['netflix'],
  steam: ['steam'],
  xbox: ['xbox'],
  playstation: ['playstation', 'psn', 'ps store', 'ps-'],
  apple: ['apple', 'itunes', 'app store'],
  spotify: ['spotify'],
  googleplay: ['google', 'gplay'],
  pubg: ['pubg'],
  razer: ['razer'],
  cod: ['call of duty', 'callofduty', 'cod ', 'cod-', 'warzone']
};
const PREFERRED_COUNTRY = ['USA', 'US', 'GLOBAL', 'GLB', 'WW', 'INT'];

export interface MappingSuggestion {
  productId: string; brandId: string; valueUsd: number;
  externalId: string | null; providerName: string | null; country: string | null;
  priceCents: number | null; discountPct: number | null; costCents: number | null;
  current: { externalId: string; costCents: number } | null;
  note?: string;
}

export async function suggestMappings(ctx: Ctx, providerId: string): Promise<MappingSuggestion[]> {
  const ours = await many(ctx.db, `
    SELECT p.id, p.brand_id, p.face_value_cents, b.name AS brand_name,
           s.external_product_id AS cur_ext, s.unit_cost_cents AS cur_cost
    FROM products p JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_sources s ON s.product_id = p.id AND s.provider_id = $1 AND s.is_active
    WHERE p.is_active AND b.is_active AND NOT b.is_hidden
    ORDER BY b.sort_order, p.face_value_cents`, [providerId]);
  const theirs = await many(ctx.db, `
    SELECT external_id, name, brand_name, country, currency, denominations_cents, price_cents, discount_pct, fee_cents
    FROM provider_products WHERE provider_id = $1 AND is_available`, [providerId]);

  return ours.map(p => {
    const words = KEYWORDS[p.brand_id] ?? [String(p.brand_name).toLowerCase()];
    const matches = theirs.filter(x => {
      const text = ` ${String(x.external_id)} ${x.name ?? ''} ${x.brand_name ?? ''} `.toLowerCase();
      return words.some(w => text.includes(w)) && (x.denominations_cents ?? []).includes(p.face_value_cents) && (x.currency ?? 'USD') === 'USD';
    });
    const rank = (x: any) => { const i = PREFERRED_COUNTRY.indexOf(String(x.country ?? '').toUpperCase()); return i < 0 ? 99 : i; };
    matches.sort((a, b) => rank(a) - rank(b) || String(a.external_id).localeCompare(String(b.external_id)));
    const best = matches[0];
    // the provider's price is what we pay per card (Wupex: face value minus its discount already);
    // without a price: face value minus the provider's discount, plus its fee
    const cost = !best ? null : best.price_cents != null ? Number(best.price_cents)
      : Math.round(p.face_value_cents * (1 - Number(best.discount_pct ?? 0) / 100) + Number(best.fee_cents ?? 0));
    return {
      productId: p.id, brandId: p.brand_id, valueUsd: p.face_value_cents / 100,
      externalId: best?.external_id ?? null, providerName: best?.name ?? null, country: best?.country ?? null,
      priceCents: best?.price_cents ?? null, discountPct: best?.discount_pct ?? null, costCents: cost,
      current: p.cur_ext ? { externalId: p.cur_ext, costCents: Number(p.cur_cost) } : null,
      note: !best ? 'no matching product at the provider'
        : matches.length > 1 ? `${matches.length} candidates: ${matches.slice(0, 4).map(m => m.external_id).join(', ')}` : undefined
    };
  });
}

/** Saves the suggestions that found a product. Returns how many were saved. */
export async function applyMappings(ctx: Ctx, adminId: string | null, providerId: string, rows: MappingSuggestion[]): Promise<number> {
  const ok = rows.filter(r => r.externalId && r.costCents != null);
  await withTx(ctx.db, async tx => {
    for (const r of ok) {
      await tx.query(`
        INSERT INTO product_sources (product_id, provider_id, provider_product_id, external_product_id, unit_cost_cents)
        VALUES ($1, $2, (SELECT id FROM provider_products WHERE provider_id = $2 AND external_id = $3), $3, $4)
        ON CONFLICT (product_id, provider_id) DO UPDATE SET provider_product_id = EXCLUDED.provider_product_id,
          external_product_id = EXCLUDED.external_product_id, unit_cost_cents = EXCLUDED.unit_cost_cents, is_active = true`,
        [r.productId, providerId, r.externalId, r.costCents]);
    }
    await audit(tx, adminId, 'provider.automap', 'provider', providerId, { mapped: ok.length, skipped: rows.length - ok.length });
  });
  return ok.length;
}

/** Which of our brands a provider product belongs to (null: a brand we do not carry). */
function brandFor(x: { external_id: string; name?: string | null; brand_name?: string | null }, brands: { id: string; name: string }[]): string | null {
  const text = ` ${String(x.external_id)} ${x.name ?? ''} ${x.brand_name ?? ''} `.toLowerCase();
  for (const b of brands) if ((KEYWORDS[b.id] ?? [b.name.toLowerCase()]).some(w => text.includes(w))) return b.id;
  return null;
}

/**
 * Adds our product (brand + USD value) for every value the provider sells in a brand we carry, so the catalogue
 * follows what can actually be bought. Returns what was added and the provider's brands we do not carry.
 */
export async function addProviderValues(ctx: Ctx, adminId: string | null, providerId: string) {
  return withTx(ctx.db, async (tx: Queryable) => {
    const brands = await many(tx, `SELECT id, name FROM brands WHERE is_active`);
    const theirs = await many(tx, `SELECT external_id, name, brand_name, currency, denominations_cents FROM provider_products
                                   WHERE provider_id = $1 AND is_available`, [providerId]);
    const added: string[] = [];
    const unknown = new Set<string>();
    for (const x of theirs) {
      if ((x.currency ?? 'USD') !== 'USD') continue;
      const brand = brandFor(x, brands);
      if (!brand) { unknown.add(String(x.brand_name ?? String(x.external_id).split('-')[0])); continue; }
      for (const c of (x.denominations_cents ?? []) as number[]) {
        const r = await tx.query(`INSERT INTO products (brand_id, face_value_cents) VALUES ($1,$2)
                                  ON CONFLICT (brand_id, face_value_cents, face_currency, region) DO NOTHING RETURNING id`, [brand, c]);
        if (r.rowCount) added.push(`${brand} $${c / 100}`);
      }
    }
    await audit(tx, adminId, 'provider.add_values', 'provider', providerId, { added });
    return { added, brandsNotCarried: [...unknown].sort() };
  });
}
