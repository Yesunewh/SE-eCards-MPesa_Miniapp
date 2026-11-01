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

## How the front end is wired to the API

`../index.html` (mini app) and `../admin.html` (admin panel) load `../assets/ecards-api.js` and then decide:

- **Server mode**: `GET /health` answers, so every piece of data comes from the API.
  The API is found from `?api=https://…` in the address (remembered), from a `<meta name="ecards-api">` tag, or from the
  page's own server. The API serves the pages itself when `STATIC_DIR` is set, so `http://<server>:10011/` just works.
- **Demo mode**: no API answers (for example the copy on cPanel), and the old browser-storage demo runs unchanged.

The screens were not rewritten. `ecards-api.js` converts server answers into the exact objects the screens already used
(`cfg`, `stock`, `orders`, `tickets`), and the pages call the API at the few places where data changes:

| In the mini app | API call |
|---|---|
| Start, then every 20 s | `GET /v1/catalog` (prices, brands, stock, banners); when signed in also `GET /v1/orders?full=1`, `/v1/wishlist`, `/v1/support/tickets` |
| Log in with M-Pesa | M-Pesa SDK `getAuthCode` (mock code outside M-Pesa) → `POST /v1/auth/mpesa` → session token |
| Pay | `POST /v1/orders` (with an idempotency key) → `POST /v1/orders/:id/pay` → poll `GET /v1/orders/:id` until paid or declined |
| Mark a code as used | `POST /v1/codes/:id/used` |
| Wishlist heart | `PUT` / `DELETE /v1/wishlist/:productId` |
| Receive by email / SMS, language | `PATCH /v1/me` |
| Support: new message, reply, read | `POST /v1/support/tickets`, `…/:id/messages`, `…/:id/seen` |

The admin panel signs in with `POST /v1/admin/login` and loads catalog, settings, stock, orders and tickets
(`GET /v1/admin/…`) every 15 s. Every change in the panel already went through one function, `act()`. In server mode
`act()` runs the change on a copy, compares before and after (`EcardsAPI.adminDiff`), and sends only the difference:
pasted codes → `POST /v1/admin/stock/:id/codes`, expected date → `PUT …/eta`, rate/VAT/support → `PATCH /v1/admin/settings`,
brand edits and values → `PUT /v1/admin/brands/:id` / `PATCH /v1/admin/products/:id`, banners and popular → `PUT /v1/admin/home`,
support replies → `POST /v1/admin/tickets/:id/reply`, close/reopen → `POST …/status`. Then it reloads from the server.
In server mode stock is the codes you upload (no stock count without codes), pre-orders are delivered by the server,
codes are shown masked, and providers (Wupex) are set up through the API, not the panel.

Staging only: with mock M-Pesa, add `?devkey=<DEV_SIMULATE_KEY>` once to the mini app address so the Pay button
approves itself. Without it, payments wait for a real M-Pesa answer.

`../web.html` (the public web store) still runs as the demo; it can use the same `ecards-api.js` in a later step.

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

### Wupex
`src/adapters/giftcards/wupex.ts` implements the documented API: balance, product list, `pull-codes`
(codes come back in the reply), order detail and order list. Tested against a fake server that answers like the docs.

**Wupex takes no reference of ours**, so a purchase whose answer is lost (timeout) cannot be looked up by our id.
The adapter stays safe by: buying one order at a time per provider (database lock), never while an earlier purchase
is unresolved; recording the newest Wupex order id just before buying; and after a timeout, taking the order newer
than that mark with the same SKU and quantity that no other purchase has claimed (a unique index guarantees a Wupex
order is claimed once). Only when Wupex shows nothing for 3 minutes is the card bought again.

Go live:
1. `.env`: `GIFTCARD_ADAPTER=wupex`, `WUPEX_BASE_URL` (sandbox first), `WUPEX_API_KEY`, `WUPEX_MERCHANT`, `WUPEX_CURRENCY`.
2. Register it: `PUT /v1/admin/providers/wupex {"name":"Wupex","adapter":"wupex","isActive":true,"buyRate":<Br per USD you pay>}`.
3. Sync and map: `npm run provider:map -- wupex` shows which Wupex SKU covers each card (USA first, then global) with the
   cost price; add `--apply` to save. Or `POST /v1/admin/providers/wupex/automap {"apply":true}`.
4. Switch the `mock` provider off: `PUT /v1/admin/providers/mock {"isActive":false}`.

Ask Wupex: currency of `price`/balance; whether `price` is the face value; whether the order list's `ReferenceId`
filter accepts our own reference (then lookups become exact); whether they allow-list server IPs.

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

### Deploying to the VPS (staging on port 10011)
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
scp release/ecards-server.tar.gz hmg@196.189.51.169:~
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

Then open `http://196.189.51.169:10011/health`. It runs in staging mode: mock M-Pesa and mock provider, no real money,
DEMO codes. `POST /v1/dev/mpesa/simulate` needs the `x-dev-key` header (`sudo grep DEV_SIMULATE_KEY /opt/ecards/.env`).
**Do not upload real gift card codes while `PAYMENTS_ADAPTER=mock`.** To update, copy a new tarball and run the last command again.
`deploy/uninstall.sh` removes everything (add `--drop-database` to delete only the database this install created).

### Hosting
The current site host (cPanel, FTP deploy) serves static files only, so it can host the HTML apps but **not** this server.
The server needs Node.js 20+ and PostgreSQL 14+: either cPanel's "Setup Node.js App" plus a PostgreSQL database if the host
offers both, or a small VPS. Use HTTPS, and back up `CODE_ENCRYPTION_KEY` separately from the database: without it,
the codes in stock cannot be read. The FTP deploy workflow excludes `server/`, so this code is never published to the web root.

### Front-end
The HTML apps still read and write browser storage. Wiring them to this API is the next step: `GET /v1/catalog` replaces
`loadConfig`/`loadStock`, `placeOrder()` becomes `POST /v1/orders` + `/pay`, and so on.
