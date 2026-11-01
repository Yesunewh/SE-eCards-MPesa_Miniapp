---
title: Backend API
tags: [ecards, technical, backend, api]
---

# Backend API

Back to [[00 Home]] · Related: [[Database]] · [[Security]]

The API base is `https://ecards.paperless.et`. All JSON. Customer and admin calls use `Authorization: Bearer <token>` (opaque token; the server stores only its SHA-256 hash).

**Errors** look like `{ "error": "code", "message": "…" }`. The error codes are also UI translation keys, for example `phoneInvalid`, `emailNeeded`, `product_unavailable`, `qty_over_limit` and `order_not_cancellable`.

## Public
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{ok:true}` with DB check. Used by the installer and the front end's API detection. |
| GET | `/`, `/index.html`, `/admin.html`, `/web.html`, `/assets/*` | Static front end (allow-list only) |
| GET | `/v1/catalog` | Brands, products, prices in santim, stock flags, home layout, settings (cached 30 s) |

## Customer login
| Method | Path | Body |
|---|---|---|
| POST | `/v1/auth/mpesa` | **Ethiopia H5:** `{ profile: { userId, name?, msisdn? }, deviceKey }` (from `userScopes`). **Generic:** `{ authCode, deviceKey? }`. Rate limited to 20 per minute. |

Returns `{ token, customer }`. Profile logins create an **unverified, device-bound** session. See [[Security#Device-bound code access]].

## Customer (requires a token)
| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/logout` | End session |
| GET / PATCH | `/v1/me` | Profile: `lang`, `deliverBy` (sms/email), `email`, `msisdn` |
| POST | `/v1/orders` | Create an unpaid order. Body: `{ items:[{productId} or {brandId, faceValueUsd}, quantity], deliverBy?, deliverTo?, lang?, channel? }`. Header `Idempotency-Key` makes retries safe. 30 per minute. |
| GET | `/v1/orders` | List (`?full=1` gives paid orders with lines and codes, the wallet) |
| GET | `/v1/orders/:id` | One order (by id or `EC########` reference) with decrypted codes (if allowed) |
| POST | `/v1/orders/:id/pay` | Start payment, which returns `clientAction` (for example `payWithMpesa` params). 10 per minute. |
| POST | `/v1/orders/:id/pay-result` | The app reports what `payWithMpesa` returned (`success` / `cancelled` / `failed`). **Informational only**: it never marks an order paid. |
| POST | `/v1/orders/:id/cancel` | Cancel an unpaid order |
| POST | `/v1/codes/:id/used` | `{used:true/false}`, the "I used this code" toggle |
| GET | `/v1/wishlist` · PUT/DELETE `/v1/wishlist/:productId` | Wishlist |
| GET / POST | `/v1/support/tickets` | List / open a ticket `{topic: order/payment/pre/other, text, orderId?}` |
| POST | `/v1/support/tickets/:id/messages` | Reply |
| POST | `/v1/support/tickets/:id/seen` | Mark staff replies as read |

### Example: start payment
```json
POST /v1/orders/7b1…/pay
→ {
  "id": "payment-uuid",
  "status": "pending",
  "clientAction": {
    "type": "payWithMpesa",
    "businessID": "<shortcode>",
    "billReference": "EC12345678",
    "amount": "150.0",
    "currency": "ETB",
    "reason": "eCards EC12345678"
  }
}
```
A second attempt on the same order uses `billReference` `EC12345678R2`, then `R3`, and so on. A late confirmation of any attempt still counts exactly once.

## Webhooks (called by M-Pesa)
The `:secret` in the path is `MPESA_CALLBACK_SECRET`. A wrong secret gets a 404.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/webhooks/mpesa-c2b/:secret/validation` | M-Pesa asks "should I accept this payment?" We check the bill reference and amount. Reply `ResultCode 0`, or `C2B00012` (invalid account) / `C2B00013` (invalid amount). |
| POST | `/v1/webhooks/mpesa-c2b/:secret/confirmation` | M-Pesa says "money received". The order becomes **paid** and fulfilment is queued. Always acknowledged. Unknown or mismatched payments are flagged for staff. |
| POST | `/v1/webhooks/mpesa/:secret` | STK push callback (Daraja-style adapter, not used) |
| POST | `/v1/webhooks/mpesa-miniapp/:secret` | Generic mini program `notifyPayment` (not used in Ethiopia) |
| POST | `/v1/dev/mpesa/simulate` | **Staging only.** Exists only with mock payments and needs the `x-dev-key` header. |

Every callback is stored in `webhook_events` (raw body, processed time, error) before it is processed, which makes callbacks replayable and auditable.

## Admin (`/v1/admin`, requires an admin token; roles owner > admin > support > viewer)
| Area | Endpoints |
|---|---|
| Session | `POST /login`, `POST /logout`, `GET /me` |
| Dashboard | `GET /dashboard` |
| Orders | `GET /orders` (`?full=1`), `GET /orders/:id` (`?reveal=1` decrypts codes and is **audited**), `POST /orders/:id/retry`, `POST /orders/:id/resend` |
| Payments | `GET /payments/review`: payments needing attention plus unmatched C2B confirmations |
| Stock | `GET /stock`, `POST /stock/:productId/codes` (paste codes), `PUT /stock/:productId/eta`, `POST /stock/codes/:id/void` |
| Catalogue | `GET/PATCH /settings`, `PUT /brands/:brandId`, `PATCH /products/:id`, `PUT /home` |
| Providers | `GET /providers`, `PUT /providers/:providerId`, `POST /providers/:providerId/sync`, `POST /providers/:providerId/automap`, `PUT /products/:id/sources/:providerId`, `GET /providers/log` |
| Support | `GET /tickets`, `POST /tickets/:id/reply`, `POST /tickets/:id/status` |
| Audit | `GET /audit` |

## Background worker
The worker runs in the same process when `RUN_WORKER=true`. It claims jobs from the `jobs` table with `FOR UPDATE SKIP LOCKED`.

| Job | What it does |
|---|---|
| `fulfil_order` | Stock → provider → pre-order for one paid order |
| `reconcile_provider_order` | Finds out what happened to a provider purchase whose result was unknown |
| `check_payment` | Asks the payment adapter for status (where supported) |
| `send_notification` | Sends the SMS/email (currently logged only) |
| `expire_orders` | Unpaid orders expire after `payment_timeout_secs` (15 min by default) |
| `retry_waiting` | Retries pre-orders through providers |

Failures retry with exponential backoff (5 s, 10 s, 20 s …, capped at 15 min) until `max_attempts`, after which the job is marked `dead`. A `dedupe_key` stops two copies of the same job from being queued or running at once.

## Rate limits
Rate limiting is off globally and set per route: login 20/min, create order 30/min, pay 10/min, open ticket 10 per 10 min.
