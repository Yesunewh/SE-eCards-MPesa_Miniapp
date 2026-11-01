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
| `web.html` | ~2,400 | Public web shop | Demo mode only (localStorage) |
| `assets/ecards-api.js` | ~500 | Shared API client | Done |

## Two modes: server mode and demo mode
The pages were first built as a clickable demo that keeps everything in `localStorage`. Instead of rewriting them, `ecards-api.js` was added, and small hooks in the pages call it.

- **Server mode.** The API was found, so all data comes from the server and every action becomes an API call.
- **Demo mode.** No API was found, so the old localStorage behaviour runs unchanged. This is handy for showing the UI offline.

**How the API is found (first match wins):**
1. `?api=https://…` in the URL. It is remembered in localStorage (`ecards-api-base`).
2. A `<meta name="ecards-api" content="https://…">` tag in the page.
3. The same server the page came from, when `GET /health` answers. This is the production setup: nginx serves both the page and the API from `ecards.paperless.et`.

## `ecards-api.js`: what it contains
| Area | Functions | Notes |
|---|---|---|
| Core | `init`, `req` | Bearer token, JSON, idempotency keys, error mapping |
| Catalogue | `fromCatalog` | Turns `/v1/catalog` into the `BRANDS`/products shape the UI already used |
| Orders | `toAppOrder`, `checkout` | Maps server orders to the app's tickets/wallet; handles `codesHidden` |
| Login | `loadSdk`, `myCall`, `deviceKey`, `signIn` | Loads hylid-bridge only inside M-Pesa; tries `userScopes` (Ethiopia) first, then `getAuthCode` (generic) |
| Pay | inside `checkout` | Calls `my.call('payWithMpesa', …)` (Ethiopia), `my.tradePay` (generic) or the mock dev flow (`?devkey=`) |
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

**When codes are hidden.** If the order was paid on another device (see device binding in [[Security]]), the card shows *"SENT BY SMS · SHOWN ON THE PHONE THAT BOUGHT IT"* instead of the code.

### Loading the M-Pesa bridge
```html
<!-- loaded by ecards-api.js only when navigator.userAgent matches /MiniProgram/ -->
<script src="https://cdn.marmot-cloud.com/npm/hylid-bridge/2.10.0/index.js"></script>
```
It is a UMD bundle that defines the global `my`. Calls look like `my.call('userScopes', {...})` and `my.call('payWithMpesa', {...})`.

## The admin panel (`admin.html`)
Sections: Dashboard, Orders (search, detail, reveal codes, retry, resend), Payments review (unmatched C2B payments, amount mismatches), Stock (paste codes, ETA, void), Catalogue (brands, products, prices), Home screen editor, Providers (Wupex: sync, auto-map, priorities, call log), Support tickets, Settings (rate, VAT, limits, support contacts), Audit log.

**Server mode wiring:**
- Admin login is real (`/v1/admin/login`), with lockout after 5 failed attempts.
- Every `act()` call becomes `serverAct()`. `EcardsAPI.adminDiff` compares old and new state and sends only the needed API calls.
- **Polling every 15 seconds** replays the same storage-event sync that the demo used between tabs.
- `fulfilWaiting` / `fulfilApi` do nothing in server mode, because the server worker fulfils. This was a real bug: the panel used to "deliver" pasted codes locally, so they were never uploaded.

## Staging helpers
- `?devkey=<DEV_SIMULATE_KEY>` makes the app approve **mock** payments itself, through `/v1/dev/mpesa/simulate`. It only works when the server runs mock payments **and** the key matches. See [[Demo Guide – Technical]].
