import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import { createPool } from './db/pool.js';
import { CodeVault } from './lib/crypto.js';
import type { PaymentsAdapter } from './adapters/payments/types.js';
import { MockPayments } from './adapters/payments/mock.js';
import { SafaricomPayments } from './adapters/payments/safaricom.js';
import { MiniAppPayments } from './adapters/payments/miniapp.js';
import type { GiftCardProvider } from './adapters/giftcards/types.js';
import { MockProvider } from './adapters/giftcards/mock.js';
import { WupexProvider } from './adapters/giftcards/wupex.js';
import type { Notifier } from './adapters/notify/index.js';
import { LogNotifier } from './adapters/notify/index.js';

/** Everything a service needs. Built once at start-up; tests build their own with mocks. */
export interface Ctx {
  cfg: Config;
  db: Db;
  vault: CodeVault;
  payments: PaymentsAdapter;
  /** Adapter for a row in `providers`, by its adapter name. */
  providerFor(adapter: string): GiftCardProvider | null;
  notifier: Notifier;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export function createContext(cfg: Config, overrides: Partial<Ctx> & { providers?: Record<string, GiftCardProvider> } = {}): Ctx {
  const db = overrides.db ?? createPool(cfg.DATABASE_URL);
  const payments = overrides.payments ?? (cfg.PAYMENTS_ADAPTER === 'miniapp'
    ? new MiniAppPayments({
        gatewayUrl: cfg.MINIAPP_GATEWAY_URL, apiPrefix: cfg.MINIAPP_API_PREFIX, clientId: cfg.MINIAPP_CLIENT_ID,
        appId: cfg.MINIAPP_APP_ID, authClientId: cfg.MINIAPP_AUTH_CLIENT_ID, privateKeyPem: cfg.MINIAPP_PRIVATE_KEY,
        platformPublicKeyPem: cfg.MINIAPP_PLATFORM_PUBLIC_KEY, keyVersion: cfg.MINIAPP_KEY_VERSION, currency: cfg.MINIAPP_CURRENCY,
        amountUnit: cfg.MINIAPP_AMOUNT_UNIT, productCode: cfg.MINIAPP_PRODUCT_CODE, userInfoPath: cfg.MINIAPP_USERINFO_PATH || undefined
      })
    : cfg.PAYMENTS_ADAPTER === 'safaricom'
    ? new SafaricomPayments({
        baseUrl: cfg.MPESA_BASE_URL, consumerKey: cfg.MPESA_CONSUMER_KEY, consumerSecret: cfg.MPESA_CONSUMER_SECRET,
        shortcode: cfg.MPESA_SHORTCODE, passkey: cfg.MPESA_PASSKEY
      })
    : new MockPayments());
  const providers: Record<string, GiftCardProvider> = overrides.providers ?? {
    mock: new MockProvider(),
    ...(cfg.GIFTCARD_ADAPTER === 'wupex'
      ? { wupex: new WupexProvider({ baseUrl: cfg.WUPEX_BASE_URL, apiKey: cfg.WUPEX_API_KEY, merchant: cfg.WUPEX_MERCHANT, currency: cfg.WUPEX_CURRENCY }) }
      : {})
  };
  return {
    cfg,
    db,
    vault: overrides.vault ?? new CodeVault(cfg.CODE_ENCRYPTION_KEY, cfg.CODE_HMAC_KEY),
    payments,
    providerFor: overrides.providerFor ?? (a => providers[a] ?? null),
    notifier: overrides.notifier ?? new LogNotifier(cfg.NODE_ENV === 'test'),
    log: overrides.log ?? ((m, x) => { if (cfg.NODE_ENV !== 'test') console.log(m, x ?? ''); })
  };
}
