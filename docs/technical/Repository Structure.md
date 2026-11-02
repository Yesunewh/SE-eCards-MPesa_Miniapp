---
title: Repository Structure
tags: [ecards, technical]
---

# Repository Structure

Back to [[00 Home]]

```
SE-eCards-MPesa_Miniapp/
├── index.html              ← customer mini app (the M-Pesa H5 entrance page)
├── admin.html              ← staff admin panel
├── web.html                ← public web store (not served yet: to be built on the API)
├── assets/
│   ├── ecards-api.js       ← API client used by index.html and admin.html
│   └── …                   ← logos, card art, banners
├── site/ , site-builder/   ← static SEO site (FTP-deployed to cPanel)
├── miniprogram/            ← native mini program web-view shell (not used for the ET H5 flow)
├── .github/workflows/deploy.yml  ← cPanel FTP deploy (ignores server/ and miniprogram/)
├── docs/                   ← this knowledge base
└── server/
    ├── package.json, tsconfig*.json, vitest config
    ├── .env.example        ← every setting, with comments (no secrets)
    ├── README.md           ← developer guide
    ├── migrations/
    │   ├── 001_init.sql          ← the whole schema
    │   ├── 002_wupex_miniapp.sql ← Wupex + mini program changes
    │   ├── 003_mpesa_et.sql      ← device binding, C2B, client result
    │   ├── 004_provider_preorders.sql ← Wupex pre-orders (partial deliveries)
    │   └── 005_brand_media.sql   ← brand pictures stored on the server
    ├── src/
    │   ├── index.ts        ← starts HTTP server (+ worker if RUN_WORKER)
    │   ├── config.ts       ← env schema (zod)
    │   ├── context.ts      ← picks adapters from config, builds Ctx
    │   ├── worker.ts       ← job loop
    │   ├── db/             ← pool.ts, migrate.ts, seed.ts
    │   ├── lib/            ← crypto.ts (CodeVault, hashing), util.ts (msisdn, prices, refs, errors)
    │   ├── services/       ← catalog, customers, orders, payments, fulfilment, stock,
    │   │                     notifications, support, wishlist, admin, jobs, providerMapping
    │   ├── adapters/
    │   │   ├── payments/   ← types, mock, mpesaEt (used), miniapp, safaricom (STK)
    │   │   ├── giftcards/  ← types, mock, wupex
    │   │   └── notify/     ← LogNotifier
    │   ├── http/           ← app.ts (+ static handler), routes/customer.ts, admin.ts, webhooks.ts
    │   └── scripts/        ← create-admin, provider-map, mpesa-register-urls
    ├── test/               ← 10 test files, fakes for Wupex and the mini program gateway
    └── deploy/             ← pack.sh, install.sh, uninstall.sh, ecards-api.service
```

About 3,700 lines of TypeScript in `server/src`.

## npm scripts (`server/`)
| Script | Does |
|---|---|
| `npm run dev` | Run with auto-reload (tsx watch) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm run typecheck` | Type-check only |
| `npm run migrate` | Apply pending SQL migrations |
| `npm run seed` | Settings, brands, products, home screen (`-- --mock-provider` for local development) |
| `npm run data:clear-test` | Remove test orders, customers and codes before go-live (`--yes` to apply) |
| `npm run admin:create` | Create an admin user |
| `npm test` | Run all tests |
| `npm run provider:map` | Sync and auto-map Wupex products. `--apply` saves; `--add-values --apply` also adds the values Wupex sells (`provider:map:dev` for the tsx version) |
| `npm run mpesa:register-urls` | Register the C2B Validation/Confirmation URLs with Safaricom |
