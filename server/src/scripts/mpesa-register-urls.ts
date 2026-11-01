/**
 * Registers our C2B Validation and Confirmation URLs with M-Pesa Ethiopia (once per shortcode / environment).
 *   set -a; . /opt/ecards/.env; set +a; node dist/scripts/mpesa-register-urls.js
 * Uses MPESA_BASE_URL, MPESA_SHORTCODE, MPESA_CONSUMER_KEY, PUBLIC_BASE_URL and MPESA_CALLBACK_SECRET.
 */
import { loadConfig } from '../config.js';
import { MpesaEtPayments } from '../adapters/payments/mpesaEt.js';

const cfg = loadConfig();
for (const k of ['MPESA_SHORTCODE', 'MPESA_CONSUMER_KEY', 'MPESA_CALLBACK_SECRET'] as const) {
  if (!cfg[k]) { console.error(`${k} is not set`); process.exit(1); }
}
if (!cfg.PUBLIC_BASE_URL.startsWith('https://')) { console.error('PUBLIC_BASE_URL must be the public https:// address'); process.exit(1); }
const base = `${cfg.PUBLIC_BASE_URL.replace(/\/+$/, '')}/v1/webhooks/mpesa-c2b/${cfg.MPESA_CALLBACK_SECRET}`;
const a = new MpesaEtPayments({ shortcode: cfg.MPESA_SHORTCODE, baseUrl: cfg.MPESA_BASE_URL, consumerKey: cfg.MPESA_CONSUMER_KEY, consumerSecret: cfg.MPESA_CONSUMER_SECRET });
const r = await a.registerUrls(`${base}/confirmation`, `${base}/validation`);
const mask = (u: string) => u.replace(cfg.MPESA_CALLBACK_SECRET, '<secret>');
console.log(`shortcode ${cfg.MPESA_SHORTCODE} at ${cfg.MPESA_BASE_URL}`);
console.log(`confirmation ${mask(r.sent.ConfirmationURL)}\nvalidation   ${mask(r.sent.ValidationURL)}`);
console.log(`M-Pesa answered HTTP ${r.http}: ${r.body.slice(0, 500)}`);
process.exitCode = r.http >= 200 && r.http < 300 ? 0 : 1;
