---
title: Acceptance Test Guide
tags: [ecards, testing, acceptance]
updated: 2026-11-02
---

# Acceptance Test Guide

Back to [[00 Home]] · Plain-language walkthrough: [[Product Walkthrough]] · Every step explained: [[Flow Walkthrough]]

Use this to check the whole system end to end on **https://ecards.paperless.et**, and again after every update. It takes about 20 minutes.

## Where things stand now
| Part | Current setting | What that means for testing |
|---|---|---|
| Payments | **Test payments** (`PAYMENTS_ADAPTER=mock`) until the M-Pesa mini program exists | No money moves. A payment is confirmed by **staff recording an M-Pesa receipt** in the admin panel, exactly as they would for a missed M-Pesa confirmation in production. |
| Sign-in | Outside the M-Pesa app: **sign in with an M-Pesa phone number** (only while payments are in test mode) | Inside M-Pesa it is `userScopes`. Once real payments are on, the web page only says "Open eCards from the M-Pesa app". |
| Gift card supplier | **Wupex sandbox** | Real Wupex test codes, bought from the Wupex test credit. |

> [!important] Before go-live, remove test data with the server command in [[Operations Runbook#Before go-live: remove test data]]. It removes test orders, customers and their codes, and keeps the catalogue, settings, pictures, admins and Wupex.

## You need
- An admin account (owner or admin role) for **https://ecards.paperless.et/admin.html**.
- A phone browser or a desktop browser in phone view (F12, then the phone icon) for **https://ecards.paperless.et/**.
- A made-up 10-character "receipt number" for test payments, for example `TEST000001` (letters and digits, 8 to 20 characters).

## 1. Catalogue and prices
1. Admin → **Pricing & settings**: note the exchange rate and VAT.
2. Mini app home: banners, popular brands and card rows load. Prices are **value × rate**, in whole Birr.
3. Admin → change the rate, save. Within about 30 seconds, the app shows the new prices.
4. Admin → **Brands** → a brand → upload a logo. The app shows it, and so does another phone or browser, because pictures are stored on the server.

✅ Pass when prices match the rate and pictures appear everywhere.

## 2. Sign-in
1. Mini app → **Log in with M-Pesa** → enter a phone number such as `0712 345 678` and a name.
2. The home screen opens and greets you by name.
3. Settings shows the name and number; **Log out** returns to the start screen.

✅ Pass when sign-in works and an invalid number (`12345`) is refused with a clear message.

## 3. Buy a card that a supplier delivers
1. Pick a card that Wupex sells (Apple, Google Play or PlayStation; see Admin → **Suppliers** → Catalogue → *Delivering*).
2. Cart → receive by SMS (own number) → **Pay with M-Pesa** → **Pay now**. The app shows *Waiting for M-Pesa*.
3. Admin → **Orders** → **Awaiting payment** → the order → enter a receipt (e.g. `TEST000001`) → **Record payment**.
4. Within a few seconds the app shows **Payment successful**, and the code appears in **My Orders**.
5. Admin → Orders → the order shows **Delivered**, *From Wupex*, and the M-Pesa receipt. **Show code** reveals it and writes the reveal to the audit log.
6. Admin → Suppliers → Call log shows `pull-codes` and `order/detail` for that order.

✅ Pass when the code arrives and the order, receipt and supplier call all match.

## 4. Payment rules
1. Record a payment with the **wrong amount**: refused ("The amount must be …").
2. Record the **same receipt** on a second order: refused ("already paid order …").
3. A user with the **support** role cannot record payments.
4. Leave an order unpaid for 15 minutes: it moves to *Expired* under Awaiting payment.

✅ Pass when each wrong case is refused and nothing is delivered.

## 5. Own stock and pre-orders
1. Admin → **Inventory** → a card with no supplier → paste two codes (one per line; with a PIN: `CODE, PIN`) → **Add to stock**.
2. Paste the same codes again: refused as already in stock.
3. Buy that card in the app and record the payment: it is delivered from **your** stock (oldest code first).
4. Buy a card with **0 codes and no supplier**: it becomes a **pre-order** with an expected date.
5. Paste a code for it: the pre-order is delivered automatically and the app shows it within 20 seconds.

✅ Pass when stock is used first, pre-orders are filled oldest first, and duplicates are refused.

## 6. Wupex pre-order
1. Buy **Steam $10** (Wupex has none in stock but can order it) and record the payment.
2. The order waits. Admin → Orders shows *Waiting for stock*, and the server checks Wupex every 2 minutes.
3. In the sandbox, Wupex's own suppliers may never deliver. If Wupex gives up, the line waits for your own stock.

✅ Pass when the order is not bought twice: Suppliers → Call log shows a single `pull-codes` for it.

## 7. Support
1. App → Settings → Contact support → send a message about an order.
2. Admin → **Support**: the message appears within 15 seconds. Reply.
3. App: the reply appears with a dot on Settings.

✅ Pass when both sides see the conversation.

## 8. Suppliers
1. Admin → Suppliers → **Sync balance and catalogue**: the balance and product count update.
2. **Link cards automatically** → preview → optionally *also add the card values Wupex sells* → **Link them**.
3. In the Catalogue, unlink a card and link it again with *Deliver as…*.

✅ Pass when the linked cards show the supplier on Inventory (plug icon) and sell even with 0 codes of your own.

## 9. Security checks
- `https://ecards.paperless.et/web.html` → 404 (not served).
- `https://ecards.paperless.et/v1/dev/mpesa/simulate` → 404 (no payment simulator exists).
- A support-role admin cannot reveal codes or record payments.
- Five wrong admin passwords lock the account for 15 minutes.

## If something fails
See [[Operations Runbook#If something goes wrong]]. Server logs: `journalctl -u ecards-api -n 200`.
