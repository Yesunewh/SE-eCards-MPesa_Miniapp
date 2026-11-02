/**
 * Map our cards to a provider's products.
 *   npm run provider:map -- wupex            sync the provider's catalog and show the suggested mapping
 *   npm run provider:map -- wupex --apply    …and save it (cost price = the provider's price)
 *   npm run provider:map -- wupex --add-values --apply
 *                                            first add our card for every value the provider sells in brands we carry
 * Run on the server with the same settings as the service:  set -a; . /opt/ecards/.env; set +a
 */
import { loadConfig } from '../config.js';
import { createContext } from '../context.js';
import { syncProvider } from '../services/admin.js';
import { addProviderValues, applyMappings, suggestMappings } from '../services/providerMapping.js';

const providerId = process.argv[2];
const apply = process.argv.includes('--apply');
const addValues = process.argv.includes('--add-values');
if (!providerId) { console.error('usage: provider-map <providerId> [--apply]'); process.exit(1); }

const ctx = createContext(loadConfig());
try {
  const sync = await syncProvider(ctx, null, providerId);
  if (!sync.ok) throw new Error(`sync failed: ${sync.error}`);
  console.log(`synced ${sync.products} products · balance ${(Number(sync.balanceCents) / 100).toFixed(2)}`);
  if (addValues) {
    if (!apply) throw new Error('--add-values changes the catalogue: add --apply as well');
    const v = await addProviderValues(ctx, null, providerId);
    console.log(`added ${v.added.length} card value(s)${v.added.length ? ': ' + v.added.join(', ') : ''}`);
    if (v.brandsNotCarried.length) console.log(`provider brands we do not carry (add them in Admin → Brands to sell them): ${v.brandsNotCarried.join(', ')}`);
  }
  const rows = await suggestMappings(ctx, providerId);
  const pad = (s: unknown, n: number) => String(s ?? '').padEnd(n).slice(0, n);
  console.log(`\n${pad('our card', 22)} ${pad('provider SKU', 26)} ${pad('country', 8)} ${pad('cost USD', 9)} note`);
  for (const r of rows) {
    console.log(`${pad(`${r.brandId} $${r.valueUsd}`, 22)} ${pad(r.externalId ?? '-', 26)} ${pad(r.country ?? '', 8)} ${pad(r.costCents != null ? (r.costCents / 100).toFixed(2) : '', 9)} ${r.note ?? ''}`);
  }
  const found = rows.filter(r => r.externalId).length;
  console.log(`\n${found} of ${rows.length} cards have a match.`);
  if (apply) console.log(`${await applyMappings(ctx, null, providerId, rows)} mappings saved.`);
  else console.log('Nothing saved. Add --apply to save these mappings.');
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await ctx.db.end();
}
