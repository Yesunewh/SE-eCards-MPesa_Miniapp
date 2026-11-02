# eCards backend

Server for the eCards M-Pesa mini app (`../index.html`) and the admin panel (`../admin.html`): a real database,
payment through M-Pesa, and gift card codes delivered from our own stock or bought from a gift card supplier (Wupex).
The pages hold no data of their own: everything comes from this server.

**Stack:** Node.js 20+ · TypeScript · Fastify · PostgreSQL 14+ · plain SQL migrations · Vitest (109 tests against a real database)

| Status | |
|---|---|
| Database schema, migrations, starting catalogue | done |
| Catalog, orders, pre-orders, stock, wishlist, support, admin, brand pictures | done |
| M-Pesa Ethiopia H5 (`userScopes`, `payWithMpesa`, C2B callbacks) | built to Safaricom's docs; **switched on once the mini program exists** |
| Staff recording of M-Pesa payments by receipt (missed confirmations) | done, audited |
| Gift card supplier fulfilment, retries, no double-buying | done; **Wupex tested against the Wupex sandbox** (real orders, pre-orders) |
| Codes by SMS / email | queued and rendered; **needs an SMS gateway / SMTP adapter** |
| Mini app and admin panel | wired to this API only |
| `../web.html` (public web store) | not served: still to be built on this API |

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

Create the schema and load the starting catalogue (add `-- --mock-provider` for a local stand-in supplier that generates codes):

```bash
npm run migrate
```

```bash
npm run seed
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

### Try a purchase with curl (test payments)

```bash
TOKEN=$(curl -s -X POST localhost:8080/v1/auth/mpesa -H 'content-type: application/json' \
  -d '{"authCode":"mock:0712345482:Hana Tesfaye"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
```

```bash
curl -s -X POST localhost:8080/v1/orders -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"items":[{"brandId":"netflix","faceValueUsd":50,"quantity":1}]}'
```

Then `POST /v1/orders/<id>/pay`. With test payments nothing confirms it by itself: an admin records the M-Pesa receipt
(`POST /v1/admin/orders/<id>/record-payment {"receipt":"…","amountMinor":<total>}`, or Orders › Awaiting payment in the
admin panel). `GET /v1/orders/<id>` then shows the codes.

---

## How the front end is wired to the API

`../index.html` (mini app) and `../admin.html` (admin panel) load `../assets/ecards-api.js`, which finds the API from
`?api=https://…` in the address (remembered), else the page's own server, else `<meta name="ecards-api">`
(`https://ecards.paperless.et`). Without an answer the pages say the service is not available: nothing runs from
browser storage. The API serves the pages itself when `STATIC_DIR` is set.

`ecards-api.js` converts server answers into the objects the screens use (`cfg`, `stock`, `orders`, `tickets`), and the
pages call the API where data changes:

| In the mini app | API call |
|---|---|
| Start, then every 20 s | `GET /v1/catalog` (prices, brands, stock, banners); when signed in also `GET /v1/orders?full=1`, `/v1/wishlist`, `/v1/support/tickets` |
| Log in with M-Pesa | inside M-Pesa: `my.call('userScopes')` → `POST /v1/auth/mpesa`; outside M-Pesa only while the server runs test payments: sign-in by phone number; otherwise "Open eCards from the M-Pesa app" |
| Pay | `POST /v1/orders` (with an idempotency key) → `POST /v1/orders/:id/pay` → poll `GET /v1/orders/:id` until paid or declined |
| Mark a code as used | `POST /v1/codes/:id/used` |
| Wishlist heart | `PUT` / `DELETE /v1/wishlist/:productId` |
| Receive by email / SMS, language | `PATCH /v1/me` |
| Support: new message, reply, read | `POST /v1/support/tickets`, `…/:id/messages`, `…/:id/seen` |

The admin panel signs in with `POST /v1/admin/login` and loads catalog, settings, stock, orders and tickets
(`GET /v1/admin/…`) every 15 s. Catalogue, stock, banner and settings changes go through `act()`, which runs the change
on a copy, compares before and after (`EcardsAPI.adminDiff`), and sends only the difference:
pasted codes → `POST /v1/admin/stock/:id/codes`, expected date → `PUT …/eta`, rate/VAT/support → `PATCH /v1/admin/settings`,
brand edits and values → `PUT /v1/admin/brands/:id` / `PATCH /v1/admin/products/:id`, banners and popular → `PUT /v1/admin/home`,
support replies → `POST /v1/admin/tickets/:id/reply`, close/reopen → `POST …/status`. Then it reloads from the server.
Direct actions call the API at once: brand pictures (`PUT/DELETE /v1/admin/brands/:id/media/:kind`, stored in the
database), code reveal (`GET /v1/admin/orders/:id?reveal=1`, audited), try delivery (`…/retry`), resend codes (`…/resend`),
awaiting payment (`GET /v1/admin/orders/unpaid`) and recording an M-Pesa payment by receipt (`…/record-payment`), and the
Suppliers page (`/v1/admin/providers…`: sync, automatic linking, link/unlink, call log).
Stock is the codes you upload, pre-orders are delivered by the server, and codes are shown masked.

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
There are no refunds in the flow; payments needing a human (wrong amount, paid twice) are flagged.

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
  rounded to whole Birr (M-Pesa charges whole Birr). VAT is included in the price.
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

New schema changes go in a new file (`002_….sql`); `npm run migrate` (and server start-up) applies anything not yet applied.

---

## API

All responses are JSON. Errors look like `{ "error": "emailInvalid", "message": "…" }`; the `error` codes reuse the
app's translation keys where one exists (`emailNeeded`, `phoneInvalid` …) so the app can show them in all 5 languages.
Customer and admin calls take `Authorization: Bearer <token>`.

**Public**

| | |
|---|---|
| `GET /health` | |
| `GET /v1/catalog` | settings, brands with products (price, VAT, availability, max qty, restock date), home banners/popular/rows |
| `POST /v1/auth/mpesa` `{authCode}` | mini app login → `{token, customer}` |
| `POST /v1/webhooks/mpesa/:secret` | M-Pesa result callback |

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

### Wupex
`src/adapters/giftcards/wupex.ts` follows the Wupex API reference v1.1 (June 2026) and was checked against the sandbox
(`https://sandbox-service.wupex.com`; the portal address is for browsers only and refuses API calls):
balance (`creditBalance` is what can be spent), product list (vouchers only; top-ups are skipped), `pull-codes`,
order detail, pre-order status. Tested against a fake server that answers like the sandbox, and with real sandbox orders.

- **Idempotent purchases.** Every purchase sends `referenceId=<our provider order id>` (for example `EC62270851-1-1`).
  Wupex answers a repeated reference with the same order (`ALREADY_COMPLETED`) and charges nothing, and orders can be read
  back by it. After a timeout we read `order/detail?referenceId=…`; only if Wupex has no such order after 90 seconds is
  the card bought again, under a new reference.
- **Codes come from `order/detail`.** `pull-codes` only answers with the order number.
- **Wupex pre-orders.** With `allowTakeAll=true`, Wupex delivers what it has and buys the rest from its suppliers
  (every 10 minutes, up to 10 times), charging only for what it delivers. The purchase is kept as `partial` and read every
  2 minutes. Codes go to the customer as they arrive. No other purchase is made for that line meanwhile. If Wupex gives up,
  the line goes back to waiting for our own stock.
- **Errors** arrive as HTTP 200 `{status:false, description:"[CODE] message"}`. Insufficient stock or balance can be retried
  later; anything else (for example `PRICE_REVIEW_REQUIRED`) cannot. Timeouts and 5xx are unknown outcomes and are looked up.
- **Cost** = Wupex `price` (face value minus their discount, in USD).

Go live:
1. `.env`: `GIFTCARD_ADAPTER=wupex`, `WUPEX_BASE_URL=https://sandbox-service.wupex.com` (production: the service URL
   Wupex gives you), `WUPEX_API_KEY`, `WUPEX_MERCHANT` (portal → avatar → merchant code), `WUPEX_CURRENCY=USD`.
2. Register it: `PUT /v1/admin/providers/wupex {"name":"Wupex","adapter":"wupex","isActive":true}`, or in SQL
   `INSERT INTO providers (id, name, adapter, environment, is_active, status) VALUES ('wupex','Wupex','wupex','sandbox',true,'ok')`.
3. Sync and map: `npm run provider:map -- wupex` shows which Wupex SKU covers each card (USA first, then global) with the
   cost price. Add `--apply` to save. `--add-values --apply` first adds our card for every value Wupex sells in brands we
   carry, and lists Wupex brands we don't carry. Or use `POST /v1/admin/providers/wupex/automap {"apply":true}`.
4. Switch the `mock` provider off: `PUT /v1/admin/providers/mock {"isActive":false}`.

Ask Wupex: the production service URL; whether they allow-list server IPs; the production catalogue (the sandbox has
no Netflix, Xbox, Spotify or PUBG).

### M-Pesa Ethiopia (H5 mini app): `PAYMENTS_ADAPTER=mpesa_et`
Following developer.safaricom.et → Mini App → H5 Mini-app:
- The mini program is of type **HTML5** with Entrance URL `https://ecards.paperless.et/`, features **UserScopes** and
  **PaymentET** enabled. Inside M-Pesa the page loads the SDK `https://cdn.marmot-cloud.com/npm/hylid-bridge/2.10.0/index.js`
  (`assets/ecards-api.js` does it when the user agent contains `MiniProgram`).
- **Login**: `my.call('userScopes', …)` returns the M-Pesa id, name and mobile to the page, which sends them with a random
  per-install device key to `POST /v1/auth/mpesa`. Our server cannot verify this identity, so such sessions see gift codes
  **only for orders placed from the same device** (codes also go by SMS; the payer's number comes from M-Pesa itself).
- **Pay**: the server answers `POST /v1/orders/:id/pay` with `{ type: 'payWithMpesa', businessID, billReference, amount, currency }`;
  the page calls `my.call('payWithMpesa', …)` and reports the outcome to `POST /v1/orders/:id/pay-result` (informational).
- **Money**: M-Pesa calls `…/v1/webhooks/mpesa-c2b/<MPESA_CALLBACK_SECRET>/validation` (we accept only an open payment's bill
  reference for its exact amount) and `…/confirmation` (marks the order paid; duplicates are harmless; wrong amounts and unknown
  references are flagged in `GET /v1/admin/payments/review`). Register both once: `npm run mpesa:register-urls`.
- `adapters/payments/miniapp.ts` (RSA-signed `payments/pay` template) and `../miniprogram/` (native web-view shell) are kept
  but not used for M-Pesa Ethiopia.

### Delivering codes
Add an SMS gateway and/or SMTP adapter in `src/adapters/notify/`. SMS texts are English only for now; Amharic, Oromo, Somali and
Tigrinya should be written by native speakers.

### Deploying to the VPS (ecards.paperless.et → port 10011 behind nginx)
`deploy/install.sh` installs the API next to whatever already runs on the server, without touching it:
its own user, its own Node.js in `/opt/ecards`, its own database inside the existing PostgreSQL (it refuses to reuse
an existing role or database), and one systemd service capped at 512 MB RAM and half a CPU at low priority.
It runs read-only checks first and stops if the port is taken or the machine is short on memory or disk.
Updates keep the keys and data, and roll back automatically if the new version does not start. Needs a user with sudo.

From your computer, in `server/`:

```bash
bash deploy/pack.sh
```

```bash
scp release/ecards-server.tar.gz <user>@<server>:~
```

On the server:

```bash
tar -xzf ecards-server.tar.gz deploy/install.sh
```

```bash
bash deploy/install.sh ecards-server.tar.gz --check
```

```bash
bash deploy/install.sh ecards-server.tar.gz
```

Then open `/health`. A new install starts with test payments (no money moves; staff record M-Pesa receipts in the
admin panel) and no supplier (`GIFTCARD_ADAPTER=none`) until the Wupex keys are added. To update, copy a new tarball
and run the last command again. Before go-live, `node dist/scripts/clear-test-data.js` (then `--yes`) removes test
orders, customers and their codes, keeping the catalogue, settings, pictures, admins and supplier.
`deploy/uninstall.sh` removes everything (add `--drop-database` to delete only the database this install created).

### Hosting
The current site host (cPanel, FTP deploy) serves static files only, so it can host the HTML apps but **not** this server.
The server needs Node.js 20+ and PostgreSQL 14+: either cPanel's "Setup Node.js App" plus a PostgreSQL database if the host
offers both, or a small VPS. Use HTTPS, and back up `CODE_ENCRYPTION_KEY` separately from the database: without it,
the codes in stock cannot be read. The FTP deploy workflow excludes `server/`, so this code is never published to the web root.

