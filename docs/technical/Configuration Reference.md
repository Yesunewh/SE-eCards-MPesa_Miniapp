---
title: Configuration Reference
tags: [ecards, technical, config]
---

# Configuration Reference

Back to [[00 Home]]

All settings are environment variables. On the VPS they live in `/opt/ecards/.env` (mode 600). The full commented template, **with no values**, is `server/.env.example`. The config is validated with zod at start-up, so a bad value stops the app with a clear message.

> [!warning] Never paste real values into git, these notes or chat.

## Core
| Variable | Meaning | Value on the server now |
|---|---|---|
| `NODE_ENV` | `development` / `test` / `production` | `production` |
| `HOST` | Listen address. Use `127.0.0.1` behind nginx. | `0.0.0.0` → change to `127.0.0.1` after HTTPS |
| `PORT` | Listen port | `10011` |
| `DATABASE_URL` | Postgres URL | `postgres://ecards:***@127.0.0.1:5433/ecards` |
| `CORS_ORIGINS` | Allowed browser origins (comma separated) | the site origins |
| `CODE_ENCRYPTION_KEY` | 32 bytes base64, AES key for codes. **Back it up separately.** | generated |
| `CODE_HMAC_KEY` | 32 bytes base64, fingerprint key | generated |
| `RUN_WORKER` | Run background jobs in this process | `true` |
| `STATIC_DIR` | Folder with index.html/admin.html/assets | set by the installer |
| `PUBLIC_BASE_URL` | Public URL used to build callback URLs | → `https://ecards.paperless.et` |

## Payments
| Variable | Meaning |
|---|---|
| `PAYMENTS_ADAPTER` | `mock` = test payments, confirmed by staff recording a receipt (now) · **`mpesa_et`** (go-live) · `miniapp` · `safaricom` |
| `MPESA_BASE_URL` | `https://apisandbox.safaricom.et` (sandbox) or the live URL |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | From developer.safaricom.et → My Apps |
| `MPESA_SHORTCODE` | businessID / C2B ShortCode. Candidate: `0711885151` (**to confirm**) |
| `MPESA_PASSKEY` | STK push only (not used) |
| `MPESA_CALLBACK_SECRET` | Long random string that goes into the callback paths |
| `MINIAPP_*` | Generic signed mini program API (not used in Ethiopia): `GATEWAY_URL`, `API_PREFIX`, `CLIENT_ID`, `APP_ID`, `AUTH_CLIENT_ID`, `PRIVATE_KEY`, `PLATFORM_PUBLIC_KEY`, `KEY_VERSION`, `CURRENCY`, `AMOUNT_UNIT`, `PRODUCT_CODE`, `USERINFO_PATH` |

## Gift cards
| Variable | Meaning |
|---|---|
| `GIFTCARD_ADAPTER` | **`wupex`** · `none` (only codes uploaded in the admin) · `mock` (generated codes, tests only) |
| `WUPEX_BASE_URL` | the **service** URL: sandbox `https://sandbox-service.wupex.com` · production: the URL Wupex gives (not the portal address) |
| `WUPEX_API_KEY` | from the Wupex portal (secret) |
| `WUPEX_MERCHANT` | merchant code (portal → avatar): `Paperless345` in the sandbox |
| `WUPEX_CURRENCY` | currency of prices and balance: `USD` (confirmed) |

## Notifications and test payments
| Variable | Meaning |
|---|---|
| `NOTIFY_ADAPTER` | `log` (only option now). An SMS gateway or SMTP is still to be added. |
| `ALLOW_MOCK_ADAPTERS` | `true` lets test payments run with `NODE_ENV=production` (until M-Pesa is connected). **Remove for go-live.** |

## Business settings (in the database, not env)
Edit these in **Admin → Settings**. They are stored in `app_settings`:
USD→ETB rate · VAT rate (0.15) · seller name · low-stock threshold (5) · auto-fulfil (on) · max quantity per line (10) · max order total (Br 500,000) · payment timeout (900 s) · default restock days (3) · support contacts (phone, email, Telegram, WhatsApp, hours).

## Go-live changes, in short
```
HOST=127.0.0.1
PUBLIC_BASE_URL=https://ecards.paperless.et
PAYMENTS_ADAPTER=mpesa_et
MPESA_BASE_URL=<live url from Safaricom>
MPESA_CONSUMER_KEY=<production key>
MPESA_CONSUMER_SECRET=<production secret>
MPESA_SHORTCODE=<confirmed business number>
MPESA_CALLBACK_SECRET=<new long random>
GIFTCARD_ADAPTER=wupex
WUPEX_BASE_URL=<production service url from Wupex>
WUPEX_API_KEY=<key>
WUPEX_MERCHANT=<code>
ALLOW_MOCK_ADAPTERS=false
```
Then run `sudo systemctl restart ecards-api` and register the C2B URLs ([[Payments – M-Pesa Ethiopia#Registering the callback URLs]]).
