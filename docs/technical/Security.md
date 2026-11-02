---
title: Security
tags: [ecards, technical, security]
---

# Security

Back to [[00 Home]] · Simple version: [[Where It Runs and How It Is Kept Safe]]

## Gift codes (the valuable asset)
- **Encrypted at rest** with AES-256-GCM. A random IV is used for every code and the auth tag is stored (`iv ‖ tag ‖ ciphertext`). Key: `CODE_ENCRYPTION_KEY`.
- **Duplicate detection** without decryption: an HMAC-SHA256 fingerprint (`CODE_HMAC_KEY`) is unique per code. Uploading the same code twice is refused.
- **Admins see `last4` only.** "Reveal" decrypts the codes and writes an `audit_log` entry.
- Provider API logs never contain codes.
- **Back up `CODE_ENCRYPTION_KEY` separately from the database.** Without it, stocked codes can't be read.

## Customers
- Session tokens are random and opaque; only their SHA-256 hash is stored.
- **Device-bound code access** is explained below.
- Prices and totals are always computed on the server.
- Orders are scoped to their owner. Another customer's order id returns 404.

### Device-bound code access
In M-Pesa Ethiopia's H5 flow, `userScopes` returns the user's id, name and phone number to **the page**, not to our server. A modified client could therefore claim to be someone else. To make that harmless:
- Logins made with this data create sessions with `verified = false` and a `device_hash`, the SHA-256 of a random key that the phone keeps.
- Each order records the `device_hash` of the session that created it.
- An unverified session sees codes **only for orders placed from the same device**. On any other device, the order is visible but its codes are hidden (`codesHidden: true`), and the app explains that the codes were sent by SMS and are shown on the phone that bought them.
- The result: someone who fakes another user's id can see order history, but can never get their codes.

Tested in `mpesa-et.test.ts`: *"identity sent by the app cannot reveal codes on another device"*.

## Payments
- **An order is paid only when the C2B Confirmation arrives** with the matching bill reference **and** amount. What the app reports (`pay-result`) is informational.
- Callback URLs contain a long secret (`MPESA_CALLBACK_SECRET`); a wrong secret gets a 404.
- Confirmations for another shortcode are ignored.
- Every callback is stored raw in `webhook_events`.
- Amount mismatches and unknown references are acknowledged (so M-Pesa does not keep retrying), but are **never fulfilled**, and they are flagged for staff.
- Payment attempts are idempotent: a duplicate confirmation does nothing.

## Staff
- Passwords use **scrypt**. Roles: `owner` > `admin` > `support` > `viewer`.
- **Lockout** after 5 failed logins for 15 minutes.
- Sensitive actions are written to `audit_log` (settings, prices, reveals, voids, retries, payment flags).

## API hardening
- zod validation on every body. Body size limits.
- Per-route rate limits (see [[Backend API#Rate limits]]).
- The static file handler serves an **allow-list only**, so there's no directory traversal and no serving of server files.
- CORS is restricted to `CORS_ORIGINS`.
- **There is no payment simulator.** A payment is paid only by M-Pesa's confirmation, or by an admin recording an M-Pesa receipt. That needs the right amount, a receipt not used before, and the admin or owner role, and it is audited.
- In production, test payments and the mock supplier are refused unless `ALLOW_MOCK_ADAPTERS=true` (used only until M-Pesa is connected). The mock supplier is loaded only where it is configured.
- Brand pictures: only real PNG/JPEG/WebP/GIF bytes (checked, not trusted from the upload), max 1.5 MB, no SVG (it can carry scripts), served with `nosniff` and a strict content policy.
- Five runtime dependencies. Packages with advisories were upgraded or removed: zod 3 → 4, vitest → 5, `@fastify/static` removed.

## Server
- The app runs as its own `ecards` user. The systemd unit uses `NoNewPrivileges`, `ProtectSystem`, private tmp, MemoryMax 512M, CPUQuota 50 % and Nice 10, so it can't starve Odoo or the other services.
- The DB is bound to `127.0.0.1:5433`, so it is not reachable from outside.
- Behind nginx, the app listens on `127.0.0.1` and no firewall port is opened.
- Secrets live only in `/opt/ecards/.env` (mode 600) and `/root/ecards-db.pass`. **Never in git and never in these notes.**

## Action items
> [!warning] Rotate
> - The **Safaricom sandbox consumer key and secret** were pasted into chat. Regenerate them in the developer portal before production and use **new production keys** for go-live.
> - The **old VPS password** (196.189.51.169) was shared in chat. Change it (the owner said they will).
> - Use a long random `MPESA_CALLBACK_SECRET` in production (it is part of the callback URLs).
