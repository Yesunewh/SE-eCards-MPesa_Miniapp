---
title: Meeting Brief
tags: [ecards, meeting]
date: 2026-11-02
---

# Meeting Brief: eCards M-Pesa Mini App

Back to [[00 Home]] · Questions to ask: [[Questions for Partners]] · Demo: [[Demo Guide – Simple]]

## In one line
**eCards** sells international gift cards (Netflix, PlayStation, Steam, Apple, Google Play…) **inside the M-Pesa app**, paid with M-Pesa, delivered in seconds. **The product is built and tested in staging. Launch is gated on Safaricom and Wupex access.**

## What exists today
- **Customer mini app**: catalogue, cart, M-Pesa login and pay, instant codes, pre-orders, support chat, wishlist, 5 languages.
- **Admin back office**: orders, stock upload, prices and rate, home screen, suppliers, payment review, support, audit log.
- **Backend server and database**: secure, automatic delivery (stock → Wupex → pre-order), encrypted codes, 107 automated tests.
- **M-Pesa Ethiopia integration** built to Safaricom's H5 docs: `userScopes` login, `payWithMpesa`, C2B Validation/Confirmation, URL registration.
- **Wupex integration** connected to the Wupex **sandbox**: a real test order through eCards delivered its code; Wupex pre-orders work too.
- **Running** on our VPS at `ecards.paperless.et` (test mode, no real money).

## What we need (decisions and access)
| # | Need | From | Blocking |
|---|---|---|---|
| 1 | **Mini program portal access** (portal.miniapps.eth.m-pesa.com) | Safaricom | Registering eCards in M-Pesa |
| 2 | **Confirm business number / businessID**: is `0711885151` correct? (It looks like a phone number; we expect a till or paybill shortcode.) | Safaricom | Receiving payments |
| 3 | Enable features **UserScopes** and **PaymentET**; confirm the H5 Entrance URL `https://ecards.paperless.et/` | Safaricom | Login and pay |
| 4 | **Production credentials** and the live API base URL; C2B URL registration in production | Safaricom | Go-live |
| 5 | Wupex **production** service URL and keys, the production catalogue (Netflix, Xbox, Spotify, PUBG?), IP allow-list (`91.107.204.59`). Sandbox: ✅ done | Wupex | Automatic card supply |
| 6 | **SMS gateway** for sending codes | Safaricom or an aggregator | SMS delivery (in-app works already) |
| 7 | Business: **USD→ETB rate and margin**, starting stock budget, Wupex prepaid balance | Internal | Pricing and supply |

## Proposed timeline (once access is granted)
| Step | Effort |
|---|---|
| Create the H5 mini program in the portal, then configure | ~1 hour |
| Switch the server to M-Pesa mode and register callbacks | ~1 hour |
| Sandbox testing inside the M-Pesa app | 1–2 days |
| Wupex sandbox → map products → test purchase | ✅ done |
| SMS connection | 1–2 days (depends on the provider) |
| Production keys, review and soft launch | depends on Safaricom review |

## Risks and how they're handled
| Risk | Mitigation |
|---|---|
| A fake "paid" signal | Only M-Pesa's server-to-server confirmation counts, with amount and reference checked |
| A customer spoofing identity | Codes are visible only on the buying device |
| Supplier timeout or double charge | Reconciliation before any re-buy |
| Running out of stock | Pre-orders with ETA, auto-delivered on restock |
| Shared server impact | Isolated install, resource caps, auto-rollback |
| Leaked keys | Keys only on the server; rotate the sandbox keys and old VPS password |

## Ask for the meeting
1. Who at Safaricom sends the **mini program portal invitation**, and when?
2. Confirm the **businessID** for `payWithMpesa` and C2B.
3. Production onboarding steps and **review time**.
4. Wupex: **production keys, catalogue and allow-list** timeline.
