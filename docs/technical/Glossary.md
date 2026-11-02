---
title: Glossary
tags: [ecards, glossary]
---

# Glossary

Back to [[00 Home]]

| Term | Meaning |
|---|---|
| **Mini app / mini program** | A small app that runs *inside* another app (here, inside M-Pesa), like a web page with special powers |
| **H5** | HTML5. A mini app that is really a web page, opened by its **Entrance URL** |
| **Entrance URL** | The address M-Pesa opens for our mini app: `https://ecards.paperless.et/` |
| **hylid-bridge** | Safaricom's JavaScript library that lets our page talk to the M-Pesa app (`my.call`) |
| **userScopes** | The M-Pesa call that asks the user to share their id, name and phone with our mini app |
| **payWithMpesa** | The M-Pesa call that opens the payment screen (the user enters their PIN) |
| **C2B** | Customer-to-Business payment, money from a customer to our business number |
| **Validation callback** | M-Pesa asks our server "is this payment OK?" *before* taking the money |
| **Confirmation callback** | M-Pesa tells our server "the money was received". This is our proof of payment. |
| **ShortCode / businessID** | Our business number in M-Pesa (till or paybill) that receives the money |
| **Bill reference** | The text attached to a payment. We use the order number (`EC12345678`, retries `…R2`) |
| **TransID** | M-Pesa's receipt number for a payment |
| **Daraja** | Safaricom's API style and name (used for the C2B formats) |
| **Consumer key / secret** | API credentials from developer.safaricom.et |
| **STK push** | A pop-up payment request sent to a phone. Not used here. |
| **Wupex** | The gift card wholesaler we buy codes from by API |
| **SKU** | A provider's product id (for example "Netflix 50 USD") |
| **pull-codes** | The Wupex call that buys codes (the codes are then read from the order) |
| **referenceId** | Our own order reference sent to Wupex, so a repeat never buys twice |
| **Wupex pre-order** | Wupex buys missing codes from its suppliers and delivers them later; charged only for what arrives |
| **Reconciliation** | Finding out afterwards what really happened when a call's result was unknown |
| **Stock** | Codes we already own and have uploaded (encrypted) |
| **Pre-order / waiting** | A paid card with no code yet. It is delivered when stock arrives. |
| **Santim** | 1/100 of a Birr. Money is stored in santim. |
| **Idempotency** | Doing the same request twice has the same effect as doing it once |
| **AES-256-GCM** | Strong encryption that also detects tampering |
| **HMAC fingerprint** | A keyed checksum used to spot duplicate codes without decrypting them |
| **scrypt** | A slow password-hashing method that resists brute force |
| **Advisory lock** | A Postgres lock we use so only one thing happens at a time (migrations) |
| **SKIP LOCKED** | A Postgres feature that lets many workers take different rows without waiting or clashing |
| **systemd** | Linux's service manager. It keeps `ecards-api` running. |
| **nginx** | The web server in front of the app. It handles HTTPS and the domain. |
| **certbot / Let's Encrypt** | Free HTTPS certificates |
| **Test payments** | `PAYMENTS_ADAPTER=mock`: no money moves; staff confirm a payment by recording an M-Pesa receipt. Used until M-Pesa is connected. |
| **Device binding** | Codes are visible only on the phone that bought them, for unverified logins |
