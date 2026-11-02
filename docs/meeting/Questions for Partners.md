---
title: Questions for Partners
tags: [ecards, meeting, safaricom, wupex]
---

# Questions for Partners

Back to [[00 Home]] · [[Meeting Brief]]

## Safaricom: M-Pesa Ethiopia
### Access and onboarding
- [ ] When will we get the **invitation to the mini program portal** (`portal.miniapps.eth.m-pesa.com`)? Who sends it?
- [ ] Which steps are needed to move from **sandbox to production**, and how long is the review?
- [ ] Is there a **sandbox M-Pesa app build** (or test SIMs or accounts) we can use to open our H5 mini app?

### Business number
- [ ] We were given **`0711885151`** as the merchant number. Is this the **businessID** for `payWithMpesa` and the **ShortCode** for C2B URL registration? (It looks like a phone number; we expected a till or paybill shortcode.)
- [ ] What business name will customers see on the payment screen?
- [ ] How and when is settlement made to our bank account?

### Mini program configuration
- [ ] Confirm type **HTML5** with Entrance URL `https://ecards.paperless.et/`.
- [ ] Enable features **UserScopes** and **PaymentET**. Anything else needed?
- [ ] Do we need to **allow-list domains** (our API is on the same domain)?
- [ ] Is `hylid-bridge` **2.10.0** from `cdn.marmot-cloud.com` the right SDK version for production?

### Login (userScopes)
- [ ] Is there a **server-side way to verify** the user identity (for example an auth code or signed token we can check), instead of trusting data from the page? (We protect against spoofing with device binding, but server verification would be better.)
- [ ] Which scopes return the **mobile number** reliably (`USER_MOBILE`)?

### Payments (payWithMpesa + C2B)
- [ ] Is the **amount format** `"150.0"` (Birr, one decimal) correct, and are there minimum or maximum amounts?
- [ ] Maximum **billReference** length and allowed characters? (We use `EC12345678`, and `EC12345678R2` on retries.)
- [ ] Is **C2B Validation** enabled for our shortcode (external validation must be switched on)?
- [ ] Production **C2B register URL** endpoint and base URL? Can we re-register the URLs later?
- [ ] Callback **source IP ranges**, so we can restrict them?
- [ ] Is there a **transaction status API** for reconciliation if a confirmation is missed?
- [ ] How do **refunds or reversals** work?

### Other
- [ ] **SMS**: can Safaricom provide a bulk SMS API for sending codes? Pricing?
- [ ] Rules for **content, branding and review** of mini apps (logos of brands like Netflix and PlayStation)?

## Wupex
- [x] Sandbox access, merchant code (`Paperless345`), API reference v1.1. **Sandbox tested OK.**
- [x] Currency: USD. Client reference: `referenceId` (works as an idempotency key, tested).
- [ ] The **production service URL** and **production API key**. When does the production account open?
- [ ] The **production catalogue**: are **Netflix, Xbox, Spotify and PUBG** available? The sandbox has only Apple, Google Play, PlayStation, Steam, Roblox and Razer.
- [ ] Do they need **IP allow-listing**? Our server IP is `91.107.204.59`.
- [ ] **Rate limits** and the max quantity per `pull-codes` call. `pull-codes` took ~8 s in the sandbox: is that normal?
- [ ] The full list of error codes (we have seen `Insufficient Stock` and `PRICE_REVIEW_REQUIRED`). Which code means **insufficient balance**?
- [ ] Pre-orders: do the sandbox's suppliers ever deliver? Our test Steam pre-order stayed `Pending` / `UNCONFIRMED`.
- [ ] Sandbox data check: **Apple $15** has `faceValue` 16 and price $15.68 (above face value). Is that intended?
- [ ] Credit line versus prepaid balance in production, and how invoices or settlement work.
- [ ] How do we **top up** the balance, and is there a low-balance alert?
- [ ] Which products are available for **our region**, and what are the code formats (code, PIN, serial, expiry)?
- [ ] The policy for **invalid or used codes** (replacement process).

## Internal (us)
- [ ] USD→ETB **selling rate and margin** per brand?
- [ ] **Starting stock** to buy, and the Wupex prepaid balance amount.
- [ ] Support **contacts and hours** shown in the app (phone, Telegram, WhatsApp, email).
- [ ] Who are the **admin users** and what are their roles?
- [ ] Launch the **web store** (`web.html`) too, or the mini app only at first?
