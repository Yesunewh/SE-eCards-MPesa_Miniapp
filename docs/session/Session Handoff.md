---
title: Session Handoff
tags: [ecards, session, handoff]
updated: 2026-11-03
---

# Session Handoff: where we are and how to continue

Back to [[00 Home]] · Full conversation: [[Conversation History]] · Details: [[Status and Roadmap]] · [[Decisions Log]]

This note lets a new Claude Code session (for example on the VPS, in `~/ecards-src`) continue exactly where the cloud session stopped on **2026-11-03**.

## The project in one paragraph
**eCards** sells international gift cards (Netflix, PlayStation, Apple, Google Play…) inside the **M-Pesa Ethiopia** app as an **H5 mini app**. Customers pay with M-Pesa, and codes are delivered from our own stock or bought from the supplier **Wupex**. It's built to production standard: there's no demo mode, and switching from test to production is a settings change. The code is in GitHub `Yesunewh/SE-eCards-MPesa_Miniapp`, branch **`backend-api`**; the latest commit at handoff is listed below.

## Working rules (agreed with the owner)
- **Commits:** branch `backend-api`. Author and committer `Yesunewh <63301786+Yesunewh@users.noreply.github.com>`, with **no Claude co-author or session trailers**. No pull request unless asked.
- **Production mindset:** no demo, sample or preview texts or features. Sandbox credentials are fine; the code paths are the production ones.
- **The VPS is shared** (`91.107.204.59`: Odoo, other Docker apps, nginx, PostgreSQL, Node/pm2, MariaDB). **Never touch other services.** eCards is isolated:
  - its own user `ecards`;
  - its own Node in `/opt/ecards/node`;
  - its own Docker database `ecards-db` on `127.0.0.1:5433`;
  - its own systemd service `ecards-api`.
- **Secrets never go in git or the docs.** They are in `/opt/ecards/.env` (mode 640, root:ecards) and `/root/ecards-db.pass` only.
- **Docs:** this Obsidian vault in `docs/`, kept up to date with every change. Plain words; technical notes in `docs/technical`, simple ones in `docs/simple`.
- The owner runs commands on the VPS and pastes the output back. On the VPS itself, Claude can run them directly, but must still ask before anything outside `/opt/ecards`, `~/ecards-src` or the `ecards-db` container.

## State at handoff
| Area | State |
|---|---|
| Code | Commit `e486e40` on `backend-api`, plus this docs commit. 109 tests passing. |
| Server | `https://ecards.paperless.et` (nginx + Let's Encrypt), app on `127.0.0.1:10011`, service `ecards-api`, releases in `/opt/ecards/releases`, `current` symlink |
| Database | Docker `ecards-db` (`postgres:16-alpine`), volume `ecards-pgdata`, migrations 001–005 (005 is applied by the next update) |
| Payments | **Test payments** (`PAYMENTS_ADAPTER=mock`, `ALLOW_MOCK_ADAPTERS=true`). Staff confirm by recording an M-Pesa receipt in Admin → Orders → Awaiting payment. M-Pesa ET (`mpesa_et`) is built but **on hold** until the mini program portal access arrives. |
| Supplier | **Wupex sandbox**: `https://sandbox-service.wupex.com`, merchant `Paperless345`, key in `.env`. Uses `referenceId` idempotency and Wupex pre-orders. |
| Merchant number | `0711885151` to try as businessID. It looks like a phone number, so it must be confirmed with Safaricom. |

## Steps the owner was given last, and may not have run yet
Check these first. They are also in [[Operations Runbook]].
1. `sudo sed -i '/^DEV_SIMULATE_KEY=/d' /opt/ecards/.env`
2. Update the code:
   - `cd ~/ecards-src && git pull && cd server && bash deploy/pack.sh`
   - then `cd ~/ecards-src/server && ECARDS_DATABASE_URL="postgres://ecards:$(cat /root/ecards-db.pass)@127.0.0.1:5433/ecards" bash deploy/install.sh release/ecards-server.tar.gz`
3. `sudo grep -E '^(PAYMENTS_ADAPTER|GIFTCARD_ADAPTER|WUPEX_BASE_URL|WUPEX_MERCHANT)=' /opt/ecards/.env`. This should show `wupex`, the sandbox URL and `Paperless345`. If Wupex isn't set up yet, see [[Gift Cards – Wupex]] → *Go live* and the earlier commands in [[Conversation History]].
4. Remove test data:
   - first a dry run: `node dist/scripts/clear-test-data.js`, run with the `.env` loaded from `/opt/ecards/current`;
   - then the same command with `--yes`.
5. Admin panel:
   - Suppliers → **Sync**;
   - then **Link cards automatically**, with *add the card values Wupex sells*;
   - re-upload brand pictures (they used to live only in the browser).
6. Run the [[Acceptance Test Guide]].

How to check the server quickly: `curl -s http://127.0.0.1:10011/health`, `systemctl status ecards-api`, `journalctl -u ecards-api -n 100`.

## Open work, in priority order
1. Finish the VPS steps above and pass the acceptance test.
2. **SMS gateway** for sending codes: an adapter in `server/src/adapters/notify/`. Today notifications are only logged.
3. Backups (daily `pg_dump` of `ecards-db`, plus a separate copy of `/opt/ecards/.env`) and uptime monitoring of `/health`.
4. Real prices (USD→ETB rate and margin) and starting stock. Watch the Wupex price quirk: Apple $15 costs $15.68.
5. Native-speaker translations: `am`, `om`, `so`, `ti`. New sentences currently fall back to English.
6. **When portal access arrives:**
   - create the HTML5 mini program (Entrance URL `https://ecards.paperless.et/`, features UserScopes and PaymentET);
   - confirm the businessID;
   - set `PAYMENTS_ADAPTER=mpesa_et` with the keys, and remove `ALLOW_MOCK_ADAPTERS`;
   - run `mpesa-register-urls`;
   - test inside the M-Pesa app.
   See [[Payments – M-Pesa Ethiopia]].
7. Wupex production account: production service URL and key, catalogue, IP allow-list for `91.107.204.59`.
8. Optional: a web store built on the API. `web.html` is not served.
9. Rotate the keys that were shown in chat: the Safaricom sandbox key and secret, the Wupex sandbox key, and the old VPS `196.189.51.169` password.

## Where things are in the code
- `index.html`: the mini app. `admin.html`: the admin panel. `assets/ecards-api.js`: the API client both use.
- `server/src`: Fastify API, services, adapters (`payments/mpesaEt.ts`, `giftcards/wupex.ts`) and the worker. `server/migrations`: SQL.
- `server/deploy`: `pack.sh`, `install.sh` (install and update, with rollback), `uninstall.sh`, the systemd unit.
- `server/src/scripts`: `create-admin`, `provider-map`, `mpesa-register-urls`, `clear-test-data`.
- Tests: `cd server && npm test`. This needs a local PostgreSQL database called `ecards_test`. **Don't run the tests against the VPS database.**
