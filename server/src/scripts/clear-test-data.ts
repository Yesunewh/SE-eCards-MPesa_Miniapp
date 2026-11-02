/**
 * Removes test data before go-live: orders, payments, customers and their sessions, support messages, notifications,
 * jobs, supplier purchases and their call log, the sample codes loaded at install, and the stand-in "mock" supplier.
 * Kept: settings, brands, card values, home screen, brand pictures, admin accounts, the audit log, the Wupex supplier
 * and its catalogue, and codes staff uploaded themselves that were not sold.
 *
 *   node dist/scripts/clear-test-data.js            shows what would be removed
 *   node dist/scripts/clear-test-data.js --yes      removes it
 *
 * Refuses on a server taking real M-Pesa payments (PAYMENTS_ADAPTER is not mock): real orders are never deleted.
 */
import { loadConfig } from '../config.js';
import { createContext } from '../context.js';
import { one, withTx } from '../db/pool.js';

const yes = process.argv.includes('--yes');
const cfg = loadConfig();
if (cfg.PAYMENTS_ADAPTER !== 'mock') {
  console.error(`This server takes real payments (PAYMENTS_ADAPTER=${cfg.PAYMENTS_ADAPTER}). Orders are not deleted here.`);
  process.exit(1);
}
const ctx = createContext(cfg);

// codes that go: sample codes from the install, anything sold or bought from a supplier, and the mock supplier's
const CODES = `gift_codes WHERE order_item_id IS NOT NULL OR provider_order_id IS NOT NULL
  OR batch_id IN (SELECT id FROM inventory_batches WHERE supplier = 'demo')`;
try {
  const n = await one(ctx.db, `SELECT
      (SELECT count(*)::int FROM orders) AS orders, (SELECT count(*)::int FROM payments) AS payments,
      (SELECT count(*)::int FROM customers) AS customers, (SELECT count(*)::int FROM support_tickets) AS tickets,
      (SELECT count(*)::int FROM ${CODES}) AS codes, (SELECT count(*)::int FROM provider_orders) AS supplier_purchases,
      (SELECT count(*)::int FROM gift_codes WHERE status = 'available' AND order_item_id IS NULL AND provider_order_id IS NULL
         AND batch_id NOT IN (SELECT id FROM inventory_batches WHERE supplier = 'demo')) AS uploaded_codes_kept,
      (SELECT count(*)::int FROM providers WHERE id = 'mock') AS mock_supplier`);
  console.log('Test data on this server:', n);
  if (!yes) { console.log('\nNothing removed. Run again with --yes to remove it.'); process.exit(0); }
  await withTx(ctx.db, async tx => {
    for (const sql of [
      `DELETE FROM notifications`, `DELETE FROM support_messages`, `DELETE FROM support_tickets`, `DELETE FROM wishlist_items`,
      `DELETE FROM ${CODES}`,
      `DELETE FROM provider_api_calls`, `DELETE FROM provider_orders`, `DELETE FROM payments`, `DELETE FROM webhook_events`,
      `DELETE FROM order_items`, `DELETE FROM orders`, `DELETE FROM jobs`, `DELETE FROM customer_sessions`, `DELETE FROM customers`,
      `DELETE FROM inventory_batches b WHERE NOT EXISTS (SELECT 1 FROM gift_codes g WHERE g.batch_id = b.id)`,
      `DELETE FROM providers WHERE id = 'mock'`
    ]) await tx.query(sql);
    await tx.query(`INSERT INTO audit_log (action, entity_type, details) VALUES ('data.clear_test', 'system', $1)`, [n]);
  });
  console.log('Test data removed.');
} finally {
  await ctx.db.end();
}
