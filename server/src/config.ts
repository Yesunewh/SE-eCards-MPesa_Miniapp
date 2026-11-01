import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform(v => v === undefined ? undefined : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

const key32 = z
  .string()
  .min(1, 'is required')
  .refine(v => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64 encoded');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: z.string().default(''),
  CODE_ENCRYPTION_KEY: key32,
  CODE_HMAC_KEY: key32,
  RUN_WORKER: bool,

  PAYMENTS_ADAPTER: z.enum(['mock', 'safaricom', 'miniapp', 'mpesa_et']).default('mock'),

  // M-Pesa mini program (my.getAuthCode / payments/pay / my.tradePay). Values come with mini program onboarding.
  MINIAPP_GATEWAY_URL: z.string().default(''),
  MINIAPP_API_PREFIX: z.string().default('/api'),
  MINIAPP_CLIENT_ID: z.string().default(''),
  MINIAPP_APP_ID: z.string().default(''),
  MINIAPP_AUTH_CLIENT_ID: z.string().default(''),
  MINIAPP_PRIVATE_KEY: z.string().default(''),          // our RSA private key: PEM, base64 of it, or a file path
  MINIAPP_PLATFORM_PUBLIC_KEY: z.string().default(''),  // the wallet's public key: PEM, base64 of it, or a file path
  MINIAPP_KEY_VERSION: z.string().default('1'),
  MINIAPP_CURRENCY: z.string().length(3).default('ETB'),
  MINIAPP_AMOUNT_UNIT: z.enum(['minor', 'major']).default('minor'),
  MINIAPP_PRODUCT_CODE: z.string().default('CASHIER_PAYMENT'),
  MINIAPP_USERINFO_PATH: z.string().default(''),
  MPESA_BASE_URL: z.string().default('https://apisandbox.safaricom.et'),
  MPESA_CONSUMER_KEY: z.string().default(''),
  MPESA_CONSUMER_SECRET: z.string().default(''),
  MPESA_SHORTCODE: z.string().default(''),
  MPESA_PASSKEY: z.string().default(''),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8080'),
  MPESA_CALLBACK_SECRET: z.string().default(''),

  GIFTCARD_ADAPTER: z.enum(['mock', 'wupex']).default('mock'),
  WUPEX_BASE_URL: z.string().default(''),
  WUPEX_API_KEY: z.string().default(''),
  WUPEX_MERCHANT: z.string().default(''),          // merchant code sent with every order line
  WUPEX_CURRENCY: z.string().length(3).default('USD'),   // currency of Wupex prices and balance (confirm with Wupex)

  NOTIFY_ADAPTER: z.enum(['log']).default('log'),

  // Staging only: run with NODE_ENV=production but mock M-Pesa / mock provider (no real money, DEMO codes).
  ALLOW_MOCK_ADAPTERS: bool,
  // When set, POST /v1/dev/mpesa/simulate works (mock payments only) but needs header x-dev-key with this value.
  DEV_SIMULATE_KEY: z.string().default(''),

  // Folder with index.html, admin.html, web.html and assets/ to serve at /. Empty = API only.
  STATIC_DIR: z.string().default('')
});

export type Config = z.infer<typeof schema> & { runWorker: boolean; corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production' && !c.ALLOW_MOCK_ADAPTERS) {
    if (c.PAYMENTS_ADAPTER === 'mock') throw new Error('PAYMENTS_ADAPTER=mock is not allowed in production');
    if (c.GIFTCARD_ADAPTER === 'mock') throw new Error('GIFTCARD_ADAPTER=mock is not allowed in production');
  }
  if (c.NODE_ENV === 'production') {
    if (c.MPESA_CALLBACK_SECRET.length < 24) throw new Error('MPESA_CALLBACK_SECRET must be at least 24 characters in production');
  }
  if (c.PAYMENTS_ADAPTER === 'mpesa_et') {
    for (const k of ['MPESA_SHORTCODE', 'MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET'] as const) {
      if (!c[k]) throw new Error(`${k} is required when PAYMENTS_ADAPTER=mpesa_et`);
    }
  }
  if (c.PAYMENTS_ADAPTER === 'miniapp') {
    for (const k of ['MINIAPP_GATEWAY_URL', 'MINIAPP_CLIENT_ID', 'MINIAPP_APP_ID', 'MINIAPP_AUTH_CLIENT_ID', 'MINIAPP_PRIVATE_KEY'] as const) {
      if (!c[k]) throw new Error(`${k} is required when PAYMENTS_ADAPTER=miniapp`);
    }
    if (c.NODE_ENV === 'production' && !c.MINIAPP_PLATFORM_PUBLIC_KEY) throw new Error('MINIAPP_PLATFORM_PUBLIC_KEY is required in production (to check M-Pesa signatures)');
  }
  if (c.GIFTCARD_ADAPTER === 'wupex') {
    for (const k of ['WUPEX_BASE_URL', 'WUPEX_API_KEY', 'WUPEX_MERCHANT'] as const) if (!c[k]) throw new Error(`${k} is required when GIFTCARD_ADAPTER=wupex`);
  }
  return {
    ...c,
    runWorker: c.RUN_WORKER ?? c.NODE_ENV !== 'test',
    corsOrigins: c.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  };
}
