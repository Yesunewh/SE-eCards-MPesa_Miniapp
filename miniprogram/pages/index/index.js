/**
 * eCards mini program: shows https://ecards.paperless.et in a web-view and does the two things a web page
 * inside M-Pesa cannot do by itself:
 *   { type: 'getAuthCode', scopes }  → my.getAuthCode  → { ok, authCode }
 *   { type: 'tradePay', paymentUrl } → my.tradePay     → { ok, resultCode }  (9000 paid, 6001 cancelled, …)
 * Every answer carries the request's id so the page can match it (assets/ecards-api.js).
 */
const APP_URL = 'https://ecards.paperless.et/';

Page({
  data: { url: APP_URL },

  onLoad(query) {
    // deep links: the mini program can be opened at a brand, e.g. ?bid=netflix
    if (query && query.bid) this.setData({ url: `${APP_URL}#product=${encodeURIComponent(query.bid)}` });
    this.webView = my.createWebViewContext('ecards');
  },

  onMessage(e) {
    const m = (e && e.detail) || {};
    const reply = r => this.webView.postMessage(Object.assign({ id: m.id }, r));
    if (m.type === 'getAuthCode') {
      my.getAuthCode({
        scopes: m.scopes || ['auth_user'],
        success: r => reply({ ok: true, authCode: r.authCode }),
        fail: r => reply({ ok: false, error: (r && (r.errorMessage || r.error)) || 'auth failed' })
      });
    } else if (m.type === 'tradePay') {
      my.tradePay({
        paymentUrl: m.paymentUrl,
        success: r => reply({ ok: String(r.resultCode) === '9000', resultCode: String(r.resultCode) }),
        fail: r => reply({ ok: false, resultCode: String((r && r.resultCode) || '4000') })
      });
    }
  }
});
