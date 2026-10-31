# eCards backend

Server for the eCards M-Pesa mini app (`../index.html`), the admin panel (`../admin.html`) and the web store (`../web.html`).
It replaces the browser storage the demo uses (`ecards-et-v2-*` keys) with a real database, takes payment through M-Pesa,
and delivers gift card codes from our own stock or from a gift card provider (Wupex).

**Stack:** Node.js 20+ · TypeScript · Fastify · PostgreSQL 14+ · plain SQL migrations · Vitest (69 tests against a real database)

| Status | |
|---|---|
| Database schema, migrations, seed (matches the demo catalog) | done |
| Catalog, orders, pre-orders, stock, wishlist, support, admin | done |
| M-Pesa payments: request, callback, status check, expiry | done; **mock** adapter works, Safaricom adapter written but **unverified** |
| Gift card provider fulfilment, retries, no double-buying | done; **mock** provider works, **Wupex adapter waits for their API docs** |
| Codes by SMS / email | queued and rendered; **needs an SMS gateway / SMTP adapter** |
| Front-end wired to this API | not yet: the HTML apps still use browser storage |

---

## Quick start

```bash
cd server
npm install
cp .env.example .env        # then fill in DATABASE_URL and the two keys
```

Generate the two keys (each 32 random bytes):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Create the schema, load the catalog, add demo stock and the mock provider:

```bash
npm run migrate
```

```bash
npm run seed -- --mock-provider --demo-stock
```

Create an admin and start the server:

```bash
ADMIN_PASSWORD='choose-a-long-one' npm run admin:create -- you@paperless.et "Your Name" owner
```

```bash
npm run dev
```

Tests (need a PostgreSQL database called `ecards_test`, or set `TEST_DATABASE_URL`; the suite wipes it):

```bash
npm test
```

### Try a purchase with curl (mock M-Pesa)

```bash
TOKEN=$(curl -s -X POST localhost:8080/v1/auth/mpesa -H 'content-type: application/json' \
  -d '{"authCode":"mock:0712345482:Hana Tesfaye"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
```

```bash
curl -s -X POST localhost:8080/v1/orders -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"items":[{"brandId":"netflix","faceValueUsd":50,"quantity":1}]}'
```

Then `POST /v1/orders/<id>/pay`, and approve it as if the customer typed their PIN with
`POST /v1/dev/mpesa/simulate {"paymentId":"<payment id>"}`. `GET /v1/orders/<id>` now shows the codes.

---

## How it works

```
 Mini app ──HTTPS──▶  Fastify API ──▶ PostgreSQL ◀── worker (same process, or several)
                          │   ▲                         │
                          │   └── M-Pesa callback       ├─ fulfil_order       stock → provider → pre-order
                          ▼                             ├─ reconcile_provider_order
                     M-Pesa (STK push)                  ├─ check_payment      late / missing callbacks
                                                        ├─ send_notification  codes by SMS / email
                                                        └─ expire_orders, retry_waiting (periodic)
```

The worker uses the `jobs` table as its queue (`FOR UPDATE SKIP LOCKED`), so no Redis is needed and
several server processes can run side by side safely.

### Order lifecycle

```
pending_payment ──M-Pesa success──▶ paid ──fulfil──▶ completed
      │   ▲                                 │
      │   └── declined / cancelled: retry   └──▶ awaiting_stock ──restock / provider──▶ completed
      ├──not paid in time──▶ expired ──(late M-Pesa success still revives it)──▶ paid
      └──customer cancels──▶ cancelled
```

Each order line (`order_items`) is `pending` → `waiting` (paid, cards still owed) → `delivered`.
Lines can be partly delivered (`delivered_quantity`); the rest waits as a pre-order with an `eta`.
As in the demo, there are no refunds in the flow; payments needing a human (wrong amount, paid twice) are flagged.

### Fulfilment rules (`src/services/fulfilment.ts`)

1. **Own stock first**: oldest available code, claimed with `FOR UPDATE SKIP LOCKED`, so two orders can never get the same code
   (tested with 20 buyers racing for 5 codes).
2. **Then a provider**, by priority, if it is active, healthy and has the balance.
   A `provider_orders` row with a unique `custom_identifier` (`EC12345678-1-1`) is written **before** the call.
3. **Timeout or 5xx from the provider**: the outcome is unknown, so we never buy again blindly.
   `reconcile_provider_order` looks the order up by its identifier, and only re-buys if the provider confirms it never got it.
4. **Otherwise the line waits** as a pre-order. Uploading codes, or the periodic `retry_waiting`, fills waiting lines oldest first.
5. If a provider ever returns more codes than needed, the extras go into stock, never lost.

### Payments (`src/services/payments.ts`)

- Prices are always computed on the server from `app_settings.usd_etb_rate` (or a per-product override),
  rounded to whole Birr (M-Pesa charges whole Birr). VAT is included in the price, as in the demo.
- Tapping "Pay" twice sends one M-Pesa request (one open payment per order, enforced by a unique index).
- Every callback is stored in `webhook_events` before processing; processing is idempotent.
- A success always wins: a late success revives an expired order. A success with the wrong amount, or a second
  success on an already-paid order, is **not** fulfilled and is flagged (`GET /v1/admin/payments/review`).
- If the callback never comes, `check_payment` asks M-Pesa directly, and gives up after 30 minutes.

---

## Data model

`migrations/001_init.sql` is the full schema, with comments. Money in Birr is stored as **santim** (`BIGINT`, 1 Br = 100),
card values and provider costs as **USD cents**. Rates and VAT are snapshotted on every order.

| Area | Tables | Notes |
|---|---|---|
| People | `customers`, `customer_sessions`, `admin_users`, `admin_sessions` | Customers come from M-Pesa login; tokens stored as SHA-256 only. Admin roles: owner > admin > support > viewer |
| Settings | `app_settings` (one row) | Rate (Br per USD), VAT, limits, payment timeout, support contacts |
| Catalog | `brands`, `products`, `home_banners`, `home_popular_brands`, `home_row_items` | A product = brand × USD face value. Brand colours/style match `BRANDS` in index.html |
| Stock | `gift_codes`, `inventory_batches`, view `product_stock` | Codes **AES-256-GCM encrypted**; `code_hmac` blocks duplicates without storing the code |
| Orders | `orders`, `order_items` | Totals are checked by constraints (`subtotal + vat = total`, `line = unit × qty`) |
| Payments | `payments`, `webhook_events` | One success and one open payment per order at most (partial unique indexes) |
| Providers | `providers`, `provider_products`, `product_sources`, `provider_orders`, `provider_api_calls` | Secrets live in env vars, never in the database. API log never contains codes |
| Messages | `notifications` | Codes are decrypted only when the message is sent |
| Customer extras | `wishlist_items`, `support_tickets`, `support_messages` | |
| Operations | `audit_log`, `jobs`, `schema_migrations` | Admin changes, code reveals and payment anomalies are audited |

Demo → database mapping: `ecards-et-v2-config` → `app_settings` + `brands` + `products` + `home_*`;
`-stock` → `gift_codes` / `products.restock_eta`; `-orders` → `orders` + `order_items` + `payments`;
`-api` → `providers` + `product_sources` + `provider_api_calls`; `-tickets` → `support_*`; `-wish` → `wishlist_items`;
`-used` → `gift_codes.customer_used_at`. The cart stays on the phone until checkout.

New schema changes go in a new file (`002_….sql`); `npm run migrate` (and server start-up) applies anything not yet applied.

---

## API

All responses are JSON. Errors look like `{ "error": "emailInvalid", "message": "…" }`; the `error` codes reuse the
demo's translation keys where one exists (`emailNeeded`, `phoneInvalid` …) so the app can show them in all 5 languages.
Customer and admin calls take `Authorization: Bearer <token>`.

**Public**

| | |
|---|---|
| `GET /health` | |
| `GET /v1/catalog` | settings, brands with products (price, VAT, availability, max qty, restock date), home banners/popular/rows |
| `POST /v1/auth/mpesa` `{authCode}` | mini app login → `{token, customer}` |
| `POST /v1/webhooks/mpesa/:secret` | M-Pesa result callback |
| `POST /v1/dev/mpesa/simulate` `{paymentId, ok}` | development only, mock payments |

**Customer**

| | |
|---|---|
| `GET /v1/me` · `PATCH /v1/me` | profile; `lang`, `deliverBy` (`email`/`sms`), `email`, `msisdn` |
| `POST /v1/orders` | `{items:[{productId} or {brandId, faceValueUsd}, quantity], deliverBy?, deliverTo?}`; send an `Idempotency-Key` header |
| `GET /v1/orders` · `GET /v1/orders/:id-or-reference` | detail includes the codes of delivered cards |
| `POST /v1/orders/:id/pay` · `POST /v1/orders/:id/cancel` | |
| `POST /v1/codes/:id/used` `{used}` | "I used this code" |
| `GET /v1/wishlist` · `PUT/DELETE /v1/wishlist/:productId` | |
| `GET/POST /v1/support/tickets` · `POST …/:id/messages` · `POST …/:id/seen` | |
| `POST /v1/auth/logout` | |

**Admin** (`/v1/admin`)

| | |
|---|---|
| `POST /login` · `POST /logout` · `GET /me` · `GET /dashboard` | 5 wrong passwords lock the account for 15 minutes |
| `GET /orders?q=&status=` · `GET /orders/:id[?reveal=1]` | search by reference, phone or M-Pesa receipt; codes masked unless revealed (admin+, audited) |
| `POST /orders/:id/retry` · `POST /orders/:id/resend` | retry fulfilment; resend codes (optionally to a new address) |
| `GET /payments/review` | wrong amounts and double payments |
| `GET /stock` · `POST /stock/:productId/codes` · `PUT /stock/:productId/eta` · `POST /stock/codes/:id/void` | upload up to 5000 codes at a time; waiting pre-orders fill automatically |
| `GET/PATCH /settings` · `PUT /brands/:id` · `PATCH /products/:id` · `PUT /home` | rate, VAT, brands, values, price overrides, banners |
| `GET /providers` · `PUT /providers/:id` · `POST /providers/:id/sync` · `PUT /products/:id/sources/:providerId` · `GET /providers/log` | Wupex set-up, catalog sync, product mapping, API log |
| `GET /tickets` · `POST /tickets/:id/reply` | |
| `GET /audit` | |

---

## Going live: open items

### Wupex (when the endpoints arrive)
Only `src/adapters/giftcards/wupex.ts` needs filling in; the rest is built and tested against the mock provider.
The file lists the questions to ask Wupex. The most important is whether **they accept our own order reference and can look orders up
by it**, because that is what prevents double purchases after a timeout. Then:

1. Set `GIFTCARD_ADAPTER=wupex` and `WUPEX_*` in `.env`.
2. `PUT /v1/admin/providers/wupex {"adapter":"wupex","isActive":true,"buyRate":…}`, then `POST /v1/admin/providers/wupex/sync`.
3. Map each product: `PUT /v1/admin/products/:id/sources/wupex {"externalProductId":"…","unitCostCents":…}`.
4. Deactivate or delete the `mock` provider.

### M-Pesa (Safaricom Ethiopia)
- **Mini app login**: `SafaricomPayments.exchangeAuthCode` needs the auth-code exchange endpoint from the mini app SDK docs.
- **Payments**: the STK push / query / callback code follows Safaricom's Daraja format; check paths and field names against
  the Ethiopia docs and test in the sandbox (`apisandbox.safaricom.et`).
- If mini app payments go through the in-app payment API instead of STK push, only `initiate` and `parseCallback` change.
- Set a long random `MPESA_CALLBACK_SECRET` and a public `PUBLIC_BASE_URL` (HTTPS).

### Delivering codes
Add an SMS gateway and/or SMTP adapter in `src/adapters/notify/`. SMS texts are English only for now; Amharic, Oromo, Somali and
Tigrinya should be written by native speakers.

### Hosting
The current site host (cPanel, FTP deploy) serves static files only, so it can host the HTML apps but **not** this server.
The server needs Node.js 20+ and PostgreSQL 14+: either cPanel's "Setup Node.js App" plus a PostgreSQL database if the host
offers both, or a small VPS. Use HTTPS, and back up `CODE_ENCRYPTION_KEY` separately from the database: without it,
the codes in stock cannot be read. The FTP deploy workflow excludes `server/`, so this code is never published to the web root.

### Front-end
The HTML apps still read and write browser storage. Wiring them to this API is the next step: `GET /v1/catalog` replaces
`loadConfig`/`loadStock`, `placeOrder()` becomes `POST /v1/orders` + `/pay`, and so on.
