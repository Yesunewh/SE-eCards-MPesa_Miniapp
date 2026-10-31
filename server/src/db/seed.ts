/**
 * Catalog and settings that match the demo app's defaults (BRANDS, defaultConfig() and ROWS0 in index.html).
 * Safe to run more than once: existing rows are left alone, so admin edits are never overwritten.
 *   npm run seed                 settings, brands, products, home screen
 *   npm run seed -- --demo-stock also uploads DEMO-… codes (development only)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import type { Db } from './pool.js';
import { withTx } from './pool.js';
import type { CodeVault } from '../lib/crypto.js';

export const CARD_VALUES_USD = [50, 100, 150, 200];

type BrandSeed = {
  id: string; name: string; label?: string; mark: string; cat: string;
  c1: string; c2: string; ink: string; tile: string; tileInk: string;
  style?: Record<string, unknown>; hidden?: boolean;
};

export const BRAND_SEED: BrandSeed[] = [
  { id: 'netflix', name: 'Netflix', mark: 'Netflix', cat: 'video', c1: '#e0151f', c2: '#760a11', ink: '#ffffff', tile: '#e23440', tileInk: '#ffffff' },
  { id: 'steam', name: 'Steam', mark: 'STEAM', cat: 'gaming', c1: '#f8f9fb', c2: '#d6dae2', ink: '#14171f', tile: '#eff0f3', tileInk: '#14171f', style: { ls: '.08em', light: true, band: 'rgba(40,46,60,.45)' } },
  { id: 'xbox', name: 'XBOX', mark: 'XBOX', cat: 'gaming', c1: '#3a3a3d', c2: '#0f0f11', ink: '#63c62d', tile: '#1d1d20', tileInk: '#63c62d', style: { ls: '.02em' } },
  { id: 'playstation', name: 'PlayStation', mark: 'PlayStation', cat: 'gaming', c1: '#0070cc', c2: '#0a2276', ink: '#ffffff', tile: '#2149cf', tileInk: '#ffffff', style: { ms: 0.84 } },
  { id: 'apple', name: 'Apple & iTunes', label: 'Apple', mark: 'Apple', cat: 'apps', c1: '#000000', c2: '#000000', ink: '#ffffff', tile: '#f3f4f6', tileInk: '#111111', style: { fw: 700, light: true, band: 'rgba(66,68,78,.42)' } },
  { id: 'spotify', name: 'Spotify', mark: 'Spotify', cat: 'music', c1: '#36c856', c2: '#0e7626', ink: '#ffffff', tile: '#1fb54c', tileInk: '#ffffff' },
  { id: 'googleplay', name: 'Google Play', mark: 'Google Play', cat: 'apps', c1: '#fcfcfd', c2: '#ffffff', ink: '#5b6068', tile: '#f3f4f6', tileInk: '#4c5158', style: { ms: 0.82, fw: 600, light: true, band: 'rgba(66,68,78,.42)' } },
  { id: 'pubg', name: 'PUBG Mobile', label: 'PUBG', mark: 'PUBG', cat: 'gaming', c1: '#000000', c2: '#000000', ink: '#f3bb1c', tile: '#3a2e05', tileInk: '#f3bb1c', style: { ls: '.05em' } },
  { id: 'razer', name: 'Razer Gold', label: 'Razer Gold', mark: 'RAZER', cat: 'gaming', c1: '#2e2e31', c2: '#0e0e0f', ink: '#47d82f', tile: '#1b1b1e', tileInk: '#47d82f', style: { ls: '.22em', ms: 0.8, fw: 700 } },
  { id: 'cod', name: 'Call of Duty', mark: 'CALL OF DUTY', cat: 'gaming', c1: '#000000', c2: '#000000', ink: '#151515', tile: '#d9d1bd', tileInk: '#1a1a1a', style: { ms: 0.66, light: true, band: 'rgba(40,36,24,.42)' } },
  { id: 'ecards', name: 'eCards', mark: 'eCards', cat: 'card', c1: '#da3431', c2: '#7a1013', ink: '#ffffff', tile: '#da3431', tileInk: '#ffffff', hidden: true }
];

export const POPULAR_SEED = ['netflix', 'steam', 'xbox', 'playstation', 'apple', 'spotify', 'googleplay', 'pubg', 'razer', 'cod'];
export const BANNER_SEED = [
  { bid: 'playstation', accent: '#6f92ff' }, { bid: 'spotify', accent: '#36c856' }, { bid: 'netflix', accent: '#e5303b' },
  { bid: 'xbox', accent: '#63c62d' }, { bid: 'apple', accent: '#ffffff' }, { bid: 'steam' }, { bid: 'pubg' }, { bid: 'cod' }
];
export const ROW_SEED: Record<string, [string, number][]> = {
  rowTop: [['playstation', 100], ['playstation', 50], ['apple', 50], ['xbox', 100], ['netflix', 100], ['spotify', 50], ['steam', 50]],
  rowGaming: [['pubg', 50], ['razer', 100], ['cod', 100], ['steam', 100], ['xbox', 50], ['playstation', 200]],
  rowStreaming: [['netflix', 50], ['spotify', 100], ['googleplay', 100], ['apple', 100], ['googleplay', 50]]
};

export async function seed(db: Db, opts: { mockProvider?: boolean } = {}): Promise<void> {
  await withTx(db, async tx => {
    await tx.query(
      `INSERT INTO app_settings (id, usd_etb_rate, vat_rate, seller_name, support)
       VALUES (1, 265, 0.15, 'eCards', $1) ON CONFLICT (id) DO NOTHING`,
      [{ phone: '', email: 'support@example.com', telegram: '', whatsapp: '', from: '08:00', to: '22:00' }]
    );
    for (const [i, b] of BRAND_SEED.entries()) {
      await tx.query(
        `INSERT INTO brands (id, name, label, mark, category, color1, color2, ink, tile, tile_ink, style, is_hidden, sort_order,
                             logo_url, card_image_url, banner_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
        [b.id, b.name, b.label ?? null, b.mark, b.cat, b.c1, b.c2, b.ink, b.tile, b.tileInk, b.style ?? {}, !!b.hidden, i * 10,
         `assets/logos/${b.id}`, `assets/cards/${b.id}`, `assets/banners/${b.id}`]
      );
      if (b.hidden) continue;
      for (const v of CARD_VALUES_USD) {
        await tx.query(
          `INSERT INTO products (brand_id, face_value_cents) VALUES ($1, $2)
           ON CONFLICT (brand_id, face_value_cents, face_currency, region) DO NOTHING`,
          [b.id, v * 100]
        );
      }
    }
    for (const [i, id] of POPULAR_SEED.entries()) {
      await tx.query(`INSERT INTO home_popular_brands (brand_id, position) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, i]);
    }
    for (const [i, x] of BANNER_SEED.entries()) {
      await tx.query(`INSERT INTO home_banners (brand_id, accent, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [x.bid, x.accent ?? null, i]);
    }
    for (const [row, items] of Object.entries(ROW_SEED)) {
      for (const [i, [bid, v]] of items.entries()) {
        await tx.query(
          `INSERT INTO home_row_items (row_key, product_id, position)
           SELECT $1, id, $4 FROM products WHERE brand_id = $2 AND face_value_cents = $3 ON CONFLICT DO NOTHING`,
          [row, bid, v * 100, i]
        );
      }
    }
    if (opts.mockProvider) {
      // Stands in for Wupex until its endpoints are available: every product mapped at ~2% below face value.
      await tx.query(
        `INSERT INTO providers (id, name, adapter, environment, is_active, status, balance_cents, low_balance_cents, buy_rate, priority)
         VALUES ('mock', 'Mock provider (demo)', 'mock', 'sandbox', true, 'ok', 1000000, 50000, 265, 100)
         ON CONFLICT (id) DO NOTHING`
      );
      await tx.query(
        `INSERT INTO product_sources (product_id, provider_id, external_product_id, unit_cost_cents)
         SELECT id, 'mock', brand_id || '-' || (face_value_cents/100), round(face_value_cents * 0.98)
         FROM products ON CONFLICT DO NOTHING`
      );
    }
  });
}

/** Development only: puts some DEMO codes in stock, leaving a few products empty to show pre-orders. */
export async function seedDemoStock(db: Db, vault: CodeVault): Promise<number> {
  const products = (await db.query(`SELECT id, brand_id, face_value_cents FROM products ORDER BY brand_id, face_value_cents`)).rows;
  const empty = new Set(['netflix:10000', 'playstation:5000', 'spotify:15000', 'steam:10000', 'apple:20000', 'googleplay:15000']);
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const g = () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('');
  let n = 0;
  for (const p of products) {
    if (empty.has(`${p.brand_id}:${p.face_value_cents}`) || p.brand_id === 'pubg') continue;
    const count = 3 + randomInt(10);
    const batch = (await db.query(
      `INSERT INTO inventory_batches (product_id, source, supplier, code_count, note) VALUES ($1,'upload','demo',$2,'demo seed') RETURNING id`,
      [p.id, count])).rows[0].id;
    for (let i = 0; i < count; i++) {
      const code = `DEMO-${g()}-${g()}-${g()}`;
      await db.query(
        `INSERT INTO gift_codes (product_id, batch_id, source, code_enc, code_hmac, code_last4, key_version)
         VALUES ($1,$2,'upload',$3,$4,$5,$6) ON CONFLICT (code_hmac) DO NOTHING`,
        [p.id, batch, vault.encrypt(code), vault.fingerprint(code), code.replace(/-/g, '').slice(-4), vault.keyVersion]
      );
      n++;
    }
  }
  return n;
}

// CLI: npm run seed [-- --demo-stock] [-- --mock-provider]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { loadConfig } = await import('../config.js');
  const { createPool } = await import('./pool.js');
  const { CodeVault } = await import('../lib/crypto.js');
  const cfg = loadConfig();
  const db = createPool(cfg.DATABASE_URL);
  try {
    const mockProvider = process.argv.includes('--mock-provider');
    await seed(db, { mockProvider });
    console.log('catalog and settings seeded' + (mockProvider ? ' (with mock provider)' : ''));
    if (process.argv.includes('--demo-stock')) {
      if (cfg.NODE_ENV === 'production') throw new Error('--demo-stock is not allowed in production');
      const n = await seedDemoStock(db, new CodeVault(cfg.CODE_ENCRYPTION_KEY, cfg.CODE_HMAC_KEY));
      console.log(`${n} demo codes added`);
    }
  } finally {
    await db.end();
  }
}
