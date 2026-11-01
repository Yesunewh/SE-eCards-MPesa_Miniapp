# eCards mini program (M-Pesa Ethiopia)

A thin native shell. The real app is `index.html`, served by the API at `https://ecards.paperless.et/`;
this mini program shows it in a `web-view` and performs the two calls a web page inside M-Pesa cannot make:

| Page asks (`my.postMessage`) | Mini program calls | Answer (`webViewContext.postMessage`) |
|---|---|---|
| `{ id, type: 'getAuthCode', scopes }` | `my.getAuthCode` | `{ id, ok, authCode }` |
| `{ id, type: 'tradePay', paymentUrl }` | `my.tradePay` | `{ id, ok, resultCode }` |

The page side is in `assets/ecards-api.js` (it loads the container's bridge `https://appx/web-view.min.js`).

## Publish
1. In the M-Pesa Ethiopia Mini Program portal: create the mini program, note its **App ID**.
2. Add `ecards.paperless.et` to the mini program's **H5 / web-view domain whitelist**.
3. Open this folder in **Mini Program Studio**, preview on a phone, then upload a version for review.
4. Server settings (`/opt/ecards/.env`): `PAYMENTS_ADAPTER=miniapp` and the `MINIAPP_*` values from onboarding
   (`MINIAPP_APP_ID` = the App ID above). Our public key goes into the portal; theirs into `MINIAPP_PLATFORM_PUBLIC_KEY`.

To check during onboarding: whether `getAuthCode` with `auth_user` returns the phone number (scope name),
and that `my.tradePay` takes `paymentUrl` from `payments/pay` (`redirectActionForm.redirectionUrl`).
