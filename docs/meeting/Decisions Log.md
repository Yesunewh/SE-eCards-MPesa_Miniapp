---
title: Decisions Log
tags: [ecards, decisions]
---

# Decisions Log

Back to [[00 Home]]

| Date | Decision | Why |
|---|---|---|
| Phase 1 | **Node.js + TypeScript + Fastify + PostgreSQL**, plain SQL, no ORM | Simple, fast and well known. Postgres locking is ideal for stock. |
| Phase 1 | **Job queue in Postgres** (no Redis) | One less service to run. Jobs are atomic with the data. |
| Phase 1 | **Encrypt gift codes** (AES-256-GCM) and show only last4 to staff | Codes are money |
| Phase 1 | Fulfilment order **stock → provider → pre-order** | Use cheaper stock first, never lose a sale |
| Phase 1 | Work on branch `backend-api`, committed as the owner's profile | The owner's request |
| Phase 2 | **Keep the existing HTML apps** and add `ecards-api.js` (server mode or demo mode) instead of rewriting | Fast, low risk; the demo still works offline |
| Phase 3 | Host the backend on a **VPS**, not cPanel | cPanel here serves static files only |
| Phase 3 | **Abandon VPS 196.189.51.169** and use **91.107.204.59** | The first was slow and hosts a critical call-centre system |
| Phase 3 | **Isolated install** (own user, own Node, Docker DB on 127.0.0.1:5433, resource caps) | Don't affect Odoo, nginx, PostgreSQL or Node already running |
| Phase 3 | Domain **ecards.paperless.et** behind nginx with HTTPS | Required by M-Pesa (HTTPS Entrance URL and callbacks) |
| Phase 4 | Wupex: **serialise purchases and reconcile with a marker** | Wupex has no client reference/idempotency key |
| 2026-11-01 | **No STK push. Use the H5 mini app** (`userScopes` + `payWithMpesa` + C2B) | The product is a mini app inside M-Pesa |
| 2026-11-01 | **Device-bound code access** for `userScopes` logins | The identity comes from the page and can't be verified by our server |
| 2026-11-01 | Order reference as **bill reference**, with `R2`, `R3` for retries | Each attempt is unique; a late confirmation still maps to the order |
| 2026-11-01 | Try **`0711885151`** as the merchant number (to confirm) | Given by the business; looks like a phone number |
| 2026-11-01 | **Hold** creating the mini program until portal access arrives | Portal is by invitation |
