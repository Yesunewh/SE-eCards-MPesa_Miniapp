---
title: What Is Done and What Is Next
tags: [ecards, simple, status]
updated: 2026-11-01
---

# What Is Done and What Is Next

Back to [[00 Home]] · Detailed: [[Status and Roadmap]]

## ✅ Done
- The **customer app** and the **admin panel** work with a real server and database.
- **Ordering, paying, delivering codes, pre-orders, support chat, wishlist and 5 languages** all work.
- **M-Pesa connection** built exactly as Safaricom's documents describe: login with M-Pesa, pay with M-Pesa, and M-Pesa's "payment received" messages.
- **Wupex connection** working with Wupex's **test (sandbox) account**: a real test order went through and the code arrived. Protection against double buying is built in.
- **Security**: encrypted codes, logs, staff roles, phone-bound codes.
- **109 automatic tests** check all of this every time.
- Running on our server at **ecards.paperless.et**. Payments are in **test mode** until the M-Pesa mini program is registered; cards come from Wupex's **test** account.
- Safaricom **developer account** created and the test connection works.

## ⏳ Waiting for partners
| From | What | Why we need it |
|---|---|---|
| **Safaricom** | Access to the **mini app portal** | To register eCards as a mini app inside M-Pesa |
| **Safaricom** | Confirm the **business number** (`0711885151`?) | It's where customers' money goes; it looks like a phone number, so we must check |
| **Safaricom** | **Live** keys | For real money |
| **Wupex** | **Production** keys and the production catalogue (the test account has no Netflix, Xbox, Spotify or PUBG) | To buy real codes automatically |
| **SMS provider** | An account | To also text codes to customers |

## 🔧 Our next steps
1. Finish the secure HTTPS certificate and update the server to the newest version.
2. Connect SMS.
3. Translations checked by native speakers.
4. Set real prices and upload starting stock.
5. Set up backups and monitoring.
6. Test inside the real M-Pesa app, then launch.

## In one line
> **The shop is built and tested. We need Safaricom's mini app access and business number, and Wupex's production keys, to switch from test mode to real money.**
