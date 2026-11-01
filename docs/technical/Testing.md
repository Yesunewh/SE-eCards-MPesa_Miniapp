---
title: Testing
tags: [ecards, technical, testing]
---

# Testing

Back to [[00 Home]]

**102 automated tests in 10 files, all passing.** They run against a real PostgreSQL (no mocks of the database), so locking, constraints and migrations are exercised for real.

```bash
cd server && npm test
```
(This needs a local Postgres. `test/global-setup.ts` creates and migrates the test database, and each test resets the data.)

| File | Tests | Covers |
|---|---|---|
| `crypto.test.ts` | 9 | AES-GCM round trip, tamper detection, fingerprints, hashing, scrypt |
| `schema.test.ts` | 10 | Migrations, constraints, triggers, the check lists |
| `orders.test.ts` | 9 | Cart rules, server-side prices, idempotency, cancel, delivery target |
| `payments.test.ts` | 13 | Payment state machine, retries, duplicate callbacks, expiry |
| `fulfilment.test.ts` | 11 | Stock first, no double-sell under concurrency, partial delivery, pre-orders, restock order, provider failure/unknown |
| `wupex.test.ts` | 10 | Wupex adapter against a fake server: purchase, paging, timeout reconciliation, double-claim guard |
| `miniapp.test.ts` | 10 | Generic signed mini program API: signatures, applyToken, pay, notify |
| `mpesa-et.test.ts` | 9 | **M-Pesa Ethiopia:** amount format, C2B parse, full userScopes → payWithMpesa → validation → confirmation → codes, cancel and retry (`…R2`), wrong amount and unknown ref, wrong secret, **device binding**, URL registration body |
| `http.test.ts` | 18 | Routes, auth, admin roles, lockout, rate limit config, error shapes |
| `static.test.ts` | 3 | Only allow-listed files are served |

## Mutation checks
To make sure the tests really catch bugs, key safety lines were deliberately broken and the tests confirmed to fail:
- removing `SKIP LOCKED` / the row locking → the double-sell test fails;
- breaking the Wupex reconciliation lookup → the reconcile test fails;
- skipping the signature check → the miniapp test fails;
- skipping the device check → the device-binding test fails.

## Browser end-to-end runs
Headless Chromium (Playwright) drove the real `index.html` and `admin.html` against a running server:
- **Mini app flow**: open, sign in, add to cart, pay (simulated), see the code, mark it used, open a ticket.
- **ET flow**: a fake `my.call` (userScopes and payWithMpesa) injected in the page, then C2B confirmation sent, then the code shows. A second "device" sees the hidden-code placeholder.
- **Admin**: log in, paste stock, see a waiting order filled, reply to a ticket.

These harness scripts are not committed. They were used for verification only.

## Other checks
- `npm run typecheck`: clean.
- `npm audit`: no known vulnerabilities at the last check.
- Installer rehearsed in a clean container. Eight bugs were found and fixed (see [[Project Log]]).
