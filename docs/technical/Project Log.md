---
title: Project Log
tags: [ecards, log]
---

# Project Log

Back to [[00 Home]]

What was done, in order. Commits are on branch `backend-api`, authored by Yesunewh.

## Phase 1: Understanding and backend
- Read the whole repo. It was a front-end-only demo (index/admin/web HTML using localStorage) plus an SEO site and an FTP deploy.
- Designed the database from the demo's data shapes (brands, products, stock, orders, tickets, settings) and wrote `001_init.sql`.
- Built the services (catalog, customers, orders, payments, fulfilment, stock, notifications, support, wishlist, admin, jobs) and the HTTP API.
- Built the security pieces: encrypted code vault, hashed tokens, scrypt, roles, lockout, audit.
- Tests against real Postgres.
- Dependency audit: zod 3 → 4 (CVE), vitest → 5, `@fastify/static` replaced by an allow-listed handler.
- Bugs fixed along the way: admin lockout SQL, jsonb COALESCE typing in provider upsert, and others.
- Push access: the first push got a 403. The owner set up a token, and the work was pushed to the new branch `backend-api` as the owner's profile.

## Phase 2: Wiring the front end
- Added `assets/ecards-api.js` and hooks in `index.html` and `admin.html` (server mode or demo mode).
- Fixed a real bug: the admin panel delivered pasted codes locally in server mode, so they never reached the server.
- Browser end-to-end runs with Playwright.

## Phase 3: Deployment
- Deploy kit: `pack.sh`, `install.sh`, `uninstall.sh`, systemd unit.
- First attempt on the old VPS `196.189.51.169`, which also hosts a call-centre system. It stalled on a slow Node download and was abandoned.
- Rehearsing the installer found 8 bugs, all fixed:
  1. a missing `ss` made a busy port look free;
  2. an existing DB role could be taken over;
  3. a symlink loop on the first install;
  4. the uninstaller had a hard-coded DB name;
  5. empty keys (helpers defined only in one branch);
  6. `sudo -u` failed as root;
  7. the env prefix with sudo was wrong;
  8. ufw rules were duplicated on update.
- New VPS `91.107.204.59` (shared with Odoo and others): recon, then a Docker DB `ecards-db` on 127.0.0.1:5433, then the install with an external DB. Health OK, owner admin created.
- DNS `ecards.paperless.et` → VPS. nginx site added. certbot failed (system pip conflict), so the snap certbot was recommended.
- The `.env.example` was being ignored by `.gitignore`: fixed.

## Phase 4: Integrations (Part A)
- Read the Wupex API docs and the M-Pesa developer docs.
- Wupex adapter: balance, catalogue paging, pull-codes, detail/list; **marker-based reconciliation** because Wupex has no client reference; advisory-lock serialisation; unique external id.
- Product mapping: CLI and admin endpoints.
- Generic mini program adapter (RSA-signed `applyToken`/`pay`/`notify`/`inquiry`) and the native `miniprogram/` shell.
- Migration `002_wupex_miniapp.sql`. The VPS was updated to it.
- Safaricom developer app created. Sandbox key and secret stored on the server; token test OK.

## Phase 5: M-Pesa Ethiopia H5 (Part B)
- Decision: **no STK push**, use the mini app.
- Studied the official PDFs and saved pages: H5 mini-app, file structure, onboarding, pay, procedure, SSO.
- Built the `mpesaEt` adapter:
  - `userScopes` login;
  - `payWithMpesa` client action;
  - C2B Validation/Confirmation with the documented result codes;
  - URL registration script.
- **Device-bound code access** to make the unverifiable `userScopes` identity safe.
- Front end loads `hylid-bridge` 2.10.0 only inside M-Pesa.
- Migration `003_mpesa_et.sql`. 102 tests passing. Commit `f50be11`.

## Phase 6: Documentation (2026-11-01)
- This knowledge base (`docs/`).
- Merchant number `0711885151` received; to be confirmed as the businessID.
- Mini program portal access is still pending, so creating the mini program is on hold.
