---
title: Demo Guide – Technical
tags: [ecards, demo, technical]
---

# Demo Guide – Technical

Back to [[00 Home]] · Non-technical talk track: [[Demo Guide – Simple]] · Step-by-step explanations: [[Flow Walkthrough]]

This demo runs on **staging**: mock M-Pesa (no real money) and the mock provider (`DEMO-…` codes). It takes about 15 minutes.

## 0. Prepare (5 minutes before)
1. Check that the server is up: `https://ecards.paperless.et/health` returns `{"ok":true,"payments":"mock",…}`. (If HTTPS isn't finished yet, use `http://91.107.204.59:10011/health`.)
2. Get the staging key on the server:
   ```bash
   sudo grep DEV_SIMULATE_KEY /opt/ecards/.env
   ```
3. Open **two browser windows**:
   - **Customer**: `https://ecards.paperless.et/?devkey=<key>` in phone view (Chrome DevTools → device toolbar → a phone such as Pixel 7). The key is remembered, so payments approve themselves.
   - **Admin**: `https://ecards.paperless.et/admin.html`, logged in as the owner admin.
4. Optional: open a terminal for the curl part (section 6).
5. Staging was seeded with DEMO stock for most cards. A few cards have **none**: Netflix $100, PlayStation $50, Spotify $150, Steam $100, Apple $200, Google Play $150, and all PUBG. A **mock supplier** stands in for Wupex and is linked to every card, so empty cards still deliver instantly ("bought from the supplier"). To show a **pre-order**, switch the mock provider off in Admin → Providers first, and switch it back on afterwards.

> [!note] Outside the M-Pesa app, the page has no `my` bridge, so login falls back to the staging login (phone + name). Inside M-Pesa, it uses `userScopes` and `payWithMpesa`. The rest of the flow is identical.

## 1. Catalogue (1 min)
- Customer window: the home screen shows banners, popular brands and rows. All of it comes from `GET /v1/catalog`, which the admin controls.
- Point out the **prices in Birr**, calculated on the server as `round(USD × rate)` with VAT included.
- Admin → Settings: change the USD→ETB rate. Within about 30 s (catalogue cache), the app's prices change.

## 2. Sign in (1 min)
- Customer: sign in (staging: phone + name).
- Explain: inside M-Pesa this is `my.call('userScopes')`. The user taps Allow, the app sends `{profile, deviceKey}` to `POST /v1/auth/mpesa`, and the session is **device-bound**.

## 3. Buy an in-stock card (3 min)
- Netflix $50 → Buy → choose SMS → Pay.
- What happens behind the scenes:
  1. `POST /v1/orders` with an `Idempotency-Key` creates `EC########` in `pending_payment`.
  2. `POST /v1/orders/:id/pay` returns `clientAction: payWithMpesa {businessID, billReference, amount, currency, reason}`.
  3. Staging: the app calls `/v1/dev/mpesa/simulate`. In production, M-Pesa calls **C2B Validation**, then **Confirmation**.
  4. The order becomes `paid`, the `fulfil_order` job claims a code from stock (`FOR UPDATE SKIP LOCKED`), and the order becomes `completed`.
- The code appears in **My Orders**. Tap "I used this code".
- Admin → Orders: the same order with the code shown as `••••1234`. Click **Reveal**, then show **Audit log**: the reveal is recorded.

## 4. Pre-order and restock (3 min)
- Customer: buy the product with zero stock. The order becomes `awaiting_stock`, and the line shows a **pre-order with an ETA**.
- Admin → Stock → that product → paste a code (any text such as `TEST-ABCD-1234`) → Save.
  - The codes are fingerprinted (duplicates refused) and encrypted. The waiting order is filled **oldest first**.
- Customer window: within 20 s (polling), the pre-order turns into a delivered code. 🎉
- Try pasting the same code again: it is refused as a duplicate.

## 5. Support (2 min)
- Customer: Support → new ticket "Where is my code?" (link to the order).
- Admin → Support: the ticket shows up (15 s polling). Reply.
- Customer: the reply appears with an unread badge.

## 6. API and safety (optional, 3 min)
```bash
BASE=https://ecards.paperless.et
curl -s $BASE/health
curl -s $BASE/v1/catalog | head -c 600
```
Show that the server ignores a tampered price: the order body has no price field at all, and the total comes from the DB.

Show a C2B **validation** refusing a wrong amount. This needs `PAYMENTS_ADAPTER=mpesa_et`; otherwise, show the test instead:
```bash
cd server && npx vitest run test/mpesa-et.test.ts
```
That test file covers the full ET flow, the wrong amount and unknown reference cases, the wrong secret, and device binding.

## 7. Admin tour (2 min)
Dashboard → Orders (filters, retry, resend) → **Payments review** (unmatched or mismatched M-Pesa payments) → Stock (ETA, void) → Catalogue/Home editor → **Providers** (Wupex: sync, auto-map, priority, call log) → Settings → Audit.

## Talking points for technical people
- **Source of truth** = the C2B Confirmation; `pay-result` from the app is informational only.
- **No double-sell**: row locks with `SKIP LOCKED`, tested under concurrency.
- **No double-buy at Wupex** even without an idempotency key: serialised purchases, a marker, then reconciliation.
- **Encrypted codes** (AES-256-GCM), HMAC dedupe, audited reveal.
- **Device binding** neutralises spoofed `userScopes` data.
- **Swappable adapters**: the same code runs mock/staging and production.
- **Safe ops**: an isolated install on a shared VPS, resource caps, automatic rollback.
- **102 tests** plus browser end-to-end runs.

## Reset after the demo
Demo orders stay in the DB, which is harmless in staging. To keep stock tidy, void test codes in Admin → Stock.
