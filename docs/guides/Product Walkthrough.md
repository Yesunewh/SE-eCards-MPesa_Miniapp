---
title: Product Walkthrough
tags: [ecards, guide, simple]
updated: 2026-11-02
---

# Product Walkthrough (for showing eCards to partners and management)

Back to [[00 Home]] · Hands-on checks: [[Acceptance Test Guide]] · Each step explained: [[Flow Walkthrough]]

Use this to walk someone through eCards. Do the clicks from the [[Acceptance Test Guide]] (sections 1, 3, 5 and 7) and **say this**.

> [!note] Today payments are in **test mode**, because the M-Pesa mini program isn't registered yet. Instead of the customer's PIN, a staff member records the M-Pesa receipt in the back office, which is the same step staff use if M-Pesa's confirmation is ever missed. The gift cards come from Wupex's **test** account.

---

### Opening (30 seconds)
> "Most people here can't pay Netflix, PlayStation or Apple directly because they need a foreign card. eCards fixes that: buy the gift card with M-Pesa, inside the M-Pesa app, and get it in seconds."

### 1. The shop
> "This is what the customer sees inside M-Pesa. All the popular brands, prices already in Birr. We control everything here from the back office: banners, the order, prices and pictures."

### 2. Sign-in
> "Inside M-Pesa there's no registration. M-Pesa asks the customer once to share their name and number with us, and they're in."

### 3. Buying
> "They pick a card and pay with the normal M-Pesa screen and their PIN. M-Pesa confirms the payment directly to our server, and only then do we release the code."

*(Record the receipt in the admin panel; the code appears.)*
> "And here's the code. It also stays in their wallet in the app, and goes out by SMS once SMS is connected."

### 4. Where the card comes from
> "We first use cards we bought in bulk. If we have none, our server buys it from our supplier, Wupex, in a few seconds, with protection so it is never bought twice. If even Wupex is out, the customer gets a pre-order with a date, and it's delivered automatically when stock arrives."

### 5. The back office
> "Every order, payment and code is here. Staff see only the last four characters of a code; showing a full code is recorded. Customer messages come into this inbox and we reply in the app."

### 6. Where we are
> "Everything you saw is built and tested: 109 automated checks run on every change, plus real test orders with Wupex. It runs on our own server at ecards.paperless.et.
> To go live we need Safaricom's mini app portal access and our business number confirmed, Wupex's production account, and an SMS provider."

---

## Questions people usually ask
| Question | Short answer |
|---|---|
| Is the money safe? | An order counts as paid only when M-Pesa itself confirms it, and the amount must match. |
| What if two people buy the last card at once? | Only one gets it; the other becomes a pre-order. A code is never sold twice. |
| What if Wupex is down? | We sell from our own stock, or take a pre-order and deliver later. |
| Can staff steal codes? | Codes are encrypted. Staff see 4 characters, and every full view is logged. |
| Which languages? | English, Amharic, Afaan Oromo, Somali, Tigrinya. |
| How fast is delivery? | Seconds after paying, when in stock or available from Wupex. |
| How do we make money? | We buy in USD at Wupex's price and sell in Birr at a rate that includes our margin. |
