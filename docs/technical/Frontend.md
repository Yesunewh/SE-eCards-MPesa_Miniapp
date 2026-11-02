---
title: Frontend
tags: [ecards, technical, frontend]
---

# Frontend

Back to [[00 Home]] · Simple version: [[The Pieces Explained Simply]]

There are three pages, each a single self-contained HTML file with no build step. They share one API client.

| File | Lines | Audience | Status |
|---|---|---|---|
| `index.html` | ~3,000 | Customers (the M-Pesa H5 mini app) | **Wired to the API** |
| `admin.html` | ~3,200 | Staff | **Wired to the API** |
| `web.html` | ~2,400 | Public web shop | **Not served**: still to be built on the API |
| `assets/ecards-api.js` | ~500 | Shared API client | Done |

## The pages run only against the server
Every piece of data (catalogue, prices, stock, orders, codes, support messages, brand pictures) comes from the eCards server, and every change goes to it. Nothing is kept or invented in the browser, apart from this device's preferences: the cart, the language and the session. If the server can't be reached, the mini app shows *"eCards is not available right now"* with **Try again**, and the admin panel says it can't reach the server.

**How the API is found (first match wins):**
1. `?api=https://…` in the URL. It is remembered in localStorage (`ecards-api-base`).
2. The same server the page came from, when `GET /health` answers. This is the normal case: nginx serves both the page and the API from `ecards.paperless.et`.
3. `<meta name="ecards-api" content="https://ecards.paperless.et">` in the page, for copies hosted elsewhere (such as cPanel).

## `ecards-api.js`: what it contains
| Area | Functions | Notes |
|---|---|---|
| Core | `init`, `req` | Bearer token, JSON, idempotency keys, error mapping |
| Catalogue | `fromCatalog` | Turns `/v1/catalog` into the `BRANDS`/products shape the UI already used |
| Orders | `toAppOrder`, `checkout` | Maps server orders to the app's tickets/wallet; handles `codesHidden` |
| Login | `loadSdk`, `myCall`, `deviceKey`, `signIn` | Inside M-Pesa: `userScopes` (Ethiopia), or `getAuthCode` (generic). Outside M-Pesa: sign-in by phone number, only while the server runs test payments; otherwise "Open eCards from the M-Pesa app" |
| Pay | inside `checkout` | Calls `my.call('payWithMpesa', …)` (Ethiopia) or `my.tradePay` (generic), then waits for the server to see M-Pesa's confirmation |
| Support | tickets helpers | Open, reply, mark seen |
| Wishlist | add/remove/list | |
| Admin | `adminLoad`, `adminDiff` | Loads everything for admin.html; turns edits into API calls |

## The mini app (`index.html`)
Screens: Home (banners, popular brands, rows), Brand page (choose value), Cart, Checkout, My Orders / Wallet (codes, "mark as used"), Wishlist, Support (tickets with chat), Profile/Settings (language, delivery: SMS or email).

**Hooks added to the page:**
- `loadShared` / `loadConfig`: catalogue and settings from `/v1/catalog`.
- `serverLogin`: sign in with M-Pesa (see [[Payments – M-Pesa Ethiopia]]).
- `serverCheckout`: create the order, start payment, call `payWithMpesa`, then poll until paid.
- `loadTickets`, `setUsed`, `toggleWish`, `saveRecv`, `applyLang`.
- **Polling every 20 seconds** refreshes orders and tickets, so pre-orders show up when they are filled.

**When codes are hidden.** If the order was paid on another device (see device binding in [[Security]]), the card shows *"SHOWN ON THE PHONE THAT BOUGHT IT"* instead of the code.

**Sign-in outside the M-Pesa app.** Only while the server runs test payments, a *Sign in* sheet asks for the M-Pesa number and name. With real payments, the page only says *"Open eCards from the M-Pesa app"*.

**Waiting for M-Pesa.** After *Pay now*, the app waits up to 3 minutes for the server to see M-Pesa's confirmation. If it doesn't come in time, the app says so, empties the cart, and the order appears in My Orders by itself once it is confirmed.

### Loading the M-Pesa bridge
```html
<!-- loaded by ecards-api.js only when navigator.userAgent matches /MiniProgram/ -->
<script src="https://cdn.marmot-cloud.com/npm/hylid-bridge/2.10.0/index.js"></script>
```
It is a UMD bundle that defines the global `my`. Calls look like `my.call('userScopes', {...})` and `my.call('payWithMpesa', {...})`.

## The admin panel (`admin.html`)
Sections:
- **Dashboard**
- **Orders**: search, detail, **Show code** (admins; audited), **Try delivery**, **Resend codes**, and **Awaiting payment** with *Record M-Pesa payment* by receipt (admins; audited).
- **Pre-orders**
- **Inventory**: paste codes (`CODE, PIN` when there is a PIN), expected dates, which cards a supplier delivers.
- **Brands**: names, colours, card values, pictures uploaded to the server.
- **Home banners**, **Customers**, **Support**.
- **Suppliers**: Wupex balance and sync; automatic linking, which can also add Wupex's card values; link and unlink per product; the call log.
- **Pricing & settings**: rate, VAT, store, support contacts.

**How it talks to the server:**
- Admin login is real (`/v1/admin/login`), with lockout after 5 failed attempts. The role is shown next to the name, and the server enforces it.
- **Catalogue edits** (brands, values, banners, settings, pasted codes, dates) go through `act()`. It applies the change to a copy, and `EcardsAPI.adminDiff` sends only the difference to the API.
- **Direct actions** call the API at once: pictures, show code, try delivery, resend, record payment, supplier actions. The panel then reloads, and looks again 2.5 seconds later, because deliveries finish on the server a moment after.
- **Every 15 seconds** the panel reloads from the server and tells you about new orders and support messages.
- The panel never delivers or changes stock by itself: the server's worker does all deliveries.
