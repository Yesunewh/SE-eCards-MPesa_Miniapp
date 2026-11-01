---
title: Tech Stack
tags: [ecards, technical]
---

# Tech Stack

Back to [[00 Home]] · See also [[System Overview]]

## Backend (`server/`)
| Piece | Choice | Why |
|---|---|---|
| Runtime | **Node.js 22** (private copy in `/opt/ecards/node` on the VPS) | Doesn't conflict with the system Node used by other apps |
| Language | **TypeScript 5.9**, ESM (`NodeNext`) | Type safety; compiled to `dist/` |
| Web framework | **Fastify 5** | Fast, schema-friendly, good plugin model |
| Plugins | `@fastify/cors` 11, `@fastify/rate-limit` 10 | CORS for split hosting; per-route rate limits |
| Static files | Custom allow-listed handler (no `@fastify/static`) | Serves only `index.html`, `admin.html`, `web.html`, `/assets/*`; removed a dependency with advisories |
| Validation | **zod 4** | Validates every request body and the environment config |
| Database driver | **pg 8** | Plain SQL, no ORM |
| Database | **PostgreSQL 16** | Transactions, row locking (`SKIP LOCKED`), JSONB, `pgcrypto` |
| Job queue | Postgres `jobs` table | No Redis needed; atomic with the data |
| Crypto | Node `crypto` | AES-256-GCM, HMAC-SHA256, scrypt, SHA-256, RSA signing (miniapp adapter) |
| Tests | **vitest 5** | 102 tests against a real Postgres |
| Dev runner | **tsx** | `npm run dev` with watch mode |

Runtime dependencies are only five packages: fastify, @fastify/cors, @fastify/rate-limit, pg, zod. A small dependency set means a small attack surface. `npm audit` was clean at the last check.

## Frontend
| Piece | Choice |
|---|---|
| Mini app | One self-contained `index.html` (vanilla JS, CSS, no build step) |
| API client | `assets/ecards-api.js` (vanilla JS). Works in "server mode" or falls back to "demo mode" (localStorage). |
| M-Pesa bridge | `hylid-bridge` 2.10.0 from `cdn.marmot-cloud.com`. Loaded only inside the M-Pesa app (user agent contains `MiniProgram`). Gives the global `my.call(...)`. |
| Admin | One self-contained `admin.html` |
| Languages | English, Amharic, Afaan Oromo, Somali, Tigrinya (`en`, `am`, `om`, `so`, `ti`) |

## Infrastructure
| Piece | Choice |
|---|---|
| Server | Ubuntu 22.04 VPS `91.107.204.59` (shared with Odoo and other Docker apps) |
| Process manager | **systemd** unit `ecards-api` (memory and CPU limits, hardened) |
| Reverse proxy | **nginx** site for `ecards.paperless.et` → `127.0.0.1:10011` |
| TLS | Let's Encrypt via certbot (snap certbot recommended; the system one is broken by a pip conflict) |
| DB hosting | Docker `postgres:16-alpine`, container `ecards-db`, volume `ecards-pgdata`, bound to `127.0.0.1:5433` |
| Firewall | ufw: no new port opened when the app is behind nginx |
| DNS | A record `ecards.paperless.et` → `91.107.204.59` (cPanel zone editor) |
| CI | GitHub Actions FTP deploy of the static site to cPanel. It excludes `server/**` and `miniprogram/**`. |

## External APIs
- **Safaricom M-Pesa Ethiopia**: sandbox `https://apisandbox.safaricom.et`. OAuth token (tested OK), C2B URL registration, C2B Validation/Confirmation callbacks, and the mini app JSAPIs `userScopes` and `payWithMpesa`.
- **Wupex**: gift card wholesale API (`x-api-key`): balance, product list, pull-codes, order detail and order list.
