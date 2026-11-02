/* eCards API client, shared by the mini app (index.html) and the admin panel (admin.html).
 *
 * Catalogue, stock, orders, payments, codes and support messages all come from the eCards server.
 * Without it the pages show "not available right now"; nothing is kept or invented in the browser.
 *
 * Where the API is, in order:
 *   1. ?api=https://api.example.et in the page address (remembered on this device; ?api= with no value forgets it)
 *   2. the page's own server (https://ecards.paperless.et serves the pages and the API)
 *   3. <meta name="ecards-api" content="https://ecards.paperless.et"> in the page, for copies hosted elsewhere
 *
 * The functions below turn server answers into the shapes the screens use (cfg / stock / orders / tickets).
 */
(function () {
  'use strict';
  const mem = {};
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] ?? null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  };
  const qs = new URLSearchParams(location.search);
  if (qs.has('api')) LS.set('ecards-api-base', qs.get('api') || null);
  LS.set('ecards-dev-key', null);   // no longer used: forget it on devices that still have it
  const meta = document.querySelector('meta[name="ecards-api"]');

  const A = {
    on: false,            // true once the API answered
    base: '',             // '' = same server as the page
    payments: null,       // the server's payment connection, from /health
    phoneSignIn: false,   // sign-in by phone number outside the M-Pesa app: only while the server runs test payments
    token: null,          // customer or admin session token
    onUnauthorized: null  // set by the page: called when the session is no longer valid
  };

  /* ---------------------------------------------------------------- HTTP */
  async function req(method, path, body, opt) {
    opt = opt || {};
    const headers = Object.assign({}, opt.headers || {});
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (A.token && !opt.noAuth) headers.authorization = 'Bearer ' + A.token;
    let r;
    try {
      r = await fetch(A.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (e) {
      const err = new Error('network'); err.code = 'network'; throw err;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.message || data.error || ('HTTP ' + r.status));
      err.status = r.status; err.code = data.error || 'http_' + r.status; err.details = data.details;
      if (r.status === 401 && A.token && !opt.noAuth && typeof A.onUnauthorized === 'function') A.onUnauthorized();
      throw err;
    }
    return data;
  }
  A.req = req;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /** Finds the API. Resolves true when it answered, false when it is not reachable. Never throws. */
  A.init = async function () {
    const saved = LS.get('ecards-api-base');
    const tries = saved ? [saved] : [location.protocol === 'file:' ? null : '', meta && meta.content ? meta.content : null].filter(x => x !== null);
    for (const t of tries) {
      const base = String(t).replace(/\/+$/, '');
      try {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const tm = setTimeout(() => ctl && ctl.abort(), 4000);
        const r = await fetch(base + '/health', { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
        clearTimeout(tm);
        const j = await r.json();
        if (r.ok && j && j.ok) { A.on = true; A.base = base; A.payments = j.payments; A.phoneSignIn = j.payments === 'mock' && !inMpesa; return true; }
      } catch (e) { /* not here: try the next address */ }
    }
    return false;
  };

  /* ---------------------------------------------------------------- helpers */
  const fmtPhone = m => { if (!m) return ''; const d = String(m || '').replace(/\D/g, '').replace(/^251/, ''); return d.length === 9 ? `+251 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(m || ''); };
  const ms = v => v ? new Date(v).getTime() : null;
  const dayMs = d => d ? new Date(d + 'T12:00:00').getTime() : null;   // a date without time, safely inside that day
  A.fmtPhone = fmtPhone;

  /* ---------------------------------------------------------------- catalog → cfg + stock */
  /**
   * @param cat  GET /v1/catalog
   * @param orig the app's built-in brands { id: { name, label, mark, cat, c1, c2, ink } }
   * Returns { config, stock, pid, media }: the app's settings, stock per "brand:value", the server product id
   * per "brand:value", and brand pictures set in the admin panel.
   */
  A.fromCatalog = function (cat, orig) {
    const values = new Set(), brands = {}, custom = [], stock = {}, pid = {}, media = { logos: {}, cards: {}, banners: {} };
    // pictures uploaded in the admin panel (/media/…) or full web addresses; anything else is ignored
    const abs = u => /^\/media\//.test(u || '') ? A.base + u : /^https:\/\//.test(u || '') ? u : null;
    const live = new Set();
    cat.brands.forEach(b => {
      if (b.hidden) return;
      if (abs(b.logoUrl)) media.logos[b.id] = abs(b.logoUrl);
      if (abs(b.cardImageUrl)) media.cards[b.id] = abs(b.cardImageUrl);
      if (abs(b.bannerUrl)) media.banners[b.id] = abs(b.bannerUrl);
      const vals = b.products.map(p => p.faceValueUsd);
      vals.forEach(v => values.add(v));
      b.products.forEach(p => {
        const key = `${b.id}:${p.faceValueUsd}`;
        pid[key] = p.id;
        stock[key] = { qty: p.availability === 'out_of_stock' ? 0 : p.maxQty, eta: dayMs(p.restockEta), price: p.priceMinor / 100 };
      });
      if (vals.length) live.add(b.id);
      const o = orig[b.id];
      if (!o) {
        custom.push({ id: b.id, name: b.name, label: b.label || '', mark: b.mark, cat: b.category, c1: b.colors.c1, c2: b.colors.c2, ink: b.colors.ink });
        brands[b.id] = { on: vals.length > 0, values: vals };
        return;
      }
      // only what differs from the built-in design, so built-in tiles and word marks keep their look
      const ov = { on: vals.length > 0, values: vals };
      if (b.name !== o.name) ov.name = b.name;
      if ((b.label || '') !== (o.label || '')) ov.label = b.label || '';
      if (b.mark !== o.mark) ov.mark = b.mark;
      if (b.category !== o.cat) ov.cat = b.category;
      const lc = x => String(x || '').toLowerCase();
      if (lc(b.colors.c1) !== lc(o.c1) || lc(b.colors.c2) !== lc(o.c2) || lc(b.colors.ink) !== lc(o.ink)) {
        ov.c1 = b.colors.c1; ov.c2 = b.colors.c2; ov.ink = b.colors.ink;
      }
      brands[b.id] = ov;
    });
    Object.keys(orig).forEach(id => { if (!brands[id]) brands[id] = { on: false, values: [] }; });   // switched off on the server
    const s = cat.settings;
    return {
      config: {
        rate: s.usdEtbRate, vat: s.vatRate, seller: s.seller, values: [...values].sort((a, b) => a - b),
        lowAt: s.lowStockThreshold ?? 5, autoFulfil: true, brands, custom,
        support: Object.assign({ phone: '', email: '', telegram: '', whatsapp: '', from: '08:00', to: '22:00' }, s.support || {}),
        popular: cat.home.popular.filter(id => live.has(id)),
        banners: cat.home.banners.filter(x => live.has(x.brandId)).map(x => ({ bid: x.brandId, on: x.active !== false, title: x.title || undefined, accent: x.accent || undefined }))
      },
      stock, pid, media
    };
  };
  A.catalog = () => req('GET', '/v1/catalog', undefined, { noAuth: true });

  /* ---------------------------------------------------------------- M-Pesa mini program bridge
   * Inside M-Pesa this page runs in the eCards mini program's <web-view> (see miniprogram/). A web-view page
   * cannot call my.getAuthCode / my.tradePay itself: it asks the mini program with my.postMessage and gets the
   * answer back through my.onMessage. The bridge script comes from the container (https://appx/web-view.min.js).
   */
  const inContainer = /AlipayClient|MiniProgram|mPaaS|Nebula|AliApp|MPesa/i.test(navigator.userAgent || '');
  let bridgeReady = null;
  function loadBridge() {
    if (bridgeReady) return bridgeReady;
    bridgeReady = new Promise(res => {
      if (window.my && typeof window.my.postMessage === 'function') return res(true);
      if (!inContainer) return res(false);
      const sc = document.createElement('script');
      sc.src = 'https://appx/web-view.min.js';
      const t = setTimeout(() => res(false), 4000);
      sc.onload = () => { clearTimeout(t); res(!!(window.my && window.my.postMessage)); };
      sc.onerror = () => { clearTimeout(t); res(false); };
      document.head.appendChild(sc);
    });
    return bridgeReady;
  }
  const pending = new Map();
  let msgSeq = 0;
  function ask(type, payload, timeoutMs) {
    return new Promise((res, rej) => {
      const id = `m${Date.now()}-${++msgSeq}`;
      const tm = setTimeout(() => { pending.delete(id); const e = new Error('no answer from M-Pesa'); e.code = 'payTimeout'; rej(e); }, timeoutMs || 120000);
      pending.set(id, r => { clearTimeout(tm); res(r); });
      if (!window.my.onMessage || !window.my.onMessage.__ecards) {
        const prev = window.my.onMessage;
        window.my.onMessage = function (e) {
          const cb = e && pending.get(e.id);
          if (cb) { pending.delete(e.id); cb(e); } else if (typeof prev === 'function') prev(e);
        };
        window.my.onMessage.__ecards = true;
      }
      window.my.postMessage(Object.assign({ id, type }, payload || {}));
    });
  }
  const notInMpesa = () => { const e = new Error('Open eCards from the M-Pesa app to log in and pay.'); e.code = 'openInMpesa'; return e; };

  /* ---------------------------------------------------------------- M-Pesa Ethiopia H5 SDK (hylid-bridge)
   * developer.safaricom.et → Mini App → H5 Mini-app: inside the M-Pesa app (user agent contains "MiniProgram")
   * the page loads the JSBridge SDK, which defines a global `my` with my.call(…):
   *   my.call('userScopes', { scopes })      → { kycAllowed: [{ key, value }], kycRejected: [...] }
   *   my.call('payWithMpesa', { businessID, billReference, amount, currency, reason }) → { transactionId }
   *   failures                                → { error, errorMessage }   (201 = cancelled by the user)
   * The mini program needs the features UserScopes and PaymentET enabled in the portal.
   */
  const SDK_URL = 'https://cdn.marmot-cloud.com/npm/hylid-bridge/2.10.0/index.js';
  const inMpesa = /MiniProgram/.test(navigator.userAgent || '');
  let sdkReady = null;
  function loadSdk() {
    if (sdkReady) return sdkReady;
    sdkReady = new Promise(res => {
      if (window.my && typeof window.my.call === 'function') return res(true);
      if (!inMpesa) return res(false);
      const sc = document.createElement('script');
      sc.src = SDK_URL;
      const t = setTimeout(() => res(false), 10000);
      sc.onload = () => { clearTimeout(t); res(!!(window.my && typeof window.my.call === 'function')); };
      sc.onerror = () => { clearTimeout(t); res(false); };
      document.head.appendChild(sc);
    });
    return sdkReady;
  }
  /** my.call as a promise: { ok, res } */
  const myCall = (name, params) => new Promise(resolve => {
    try {
      window.my.call(name, Object.assign({}, params, {
        success: res => resolve({ ok: !(res && res.error), res: res || {} }),
        fail: res => resolve({ ok: false, res: res || {} })
      }));
    } catch (e) { resolve({ ok: false, res: { error: 'bridge', errorMessage: e.message } }); }
  });
  A.inMpesa = inMpesa;

  /** A random key per app install, so codes are shown only on the phone that bought them (see server customers.ts). */
  A.deviceKey = function () {
    let k = LS.get('ecards-device-key');
    if (!k || k.length < 32) {
      const b = new Uint8Array(24); (window.crypto || window.msCrypto).getRandomValues(b);
      k = 'dk-' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      LS.set('ecards-device-key', k);
    }
    return k;
  };

  /**
   * Log in. Inside M-Pesa: userScopes (M-Pesa asks the customer to share their name and mobile).
   * Outside M-Pesa: who = { phone, name }, accepted only while the server runs test payments. Resolves { token, customer }.
   */
  A.signIn = async function (who) {
    if (await loadSdk()) {
      const r = await myCall('userScopes', { scopes: ['USER_ID', 'USER_NAME', 'USER_MNAME', 'USER_LNAME', 'USER_MOBILE'] });
      if (!r.ok) {
        const e = new Error(r.res.errorMessage || 'M-Pesa login failed'); e.code = String(r.res.error) === '201' ? 'loginCancelled' : 'login_failed'; throw e;
      }
      const kv = {}; (r.res.kycAllowed || []).forEach(x => { if (x && x.key) kv[x.key] = x.value; });
      if (!kv.USER_ID) { const e = new Error('M-Pesa did not share your account id'); e.code = 'login_failed'; throw e; }
      const name = [kv.USER_NAME, kv.USER_MNAME, kv.USER_LNAME].filter(v => v && !/^[0-9a-f]{8,}(-[0-9a-f]+)+$/i.test(v)).join(' ');
      const out = await req('POST', '/v1/auth/mpesa', { profile: { userId: String(kv.USER_ID), name, msisdn: kv.USER_MOBILE || null }, deviceKey: A.deviceKey() }, { noAuth: true });
      A.token = out.token;
      return out;
    }
    const code = await A.authCode(who);
    const out = await req('POST', '/v1/auth/mpesa', { authCode: code, deviceKey: A.deviceKey() }, { noAuth: true });
    A.token = out.token;
    return out;
  };

  /* ---------------------------------------------------------------- customer session */
  /** Login code from M-Pesa (mini program); outside M-Pesa a phone sign-in, accepted only while the server runs test payments. */
  A.authCode = async function (who) {
    const my = window.my;
    if (my && typeof my.getAuthCode === 'function') {
      return new Promise((res, rej) => my.getAuthCode({ scopes: ['auth_user'], success: r => res(r.authCode || r.code), fail: rej }));
    }
    if (await loadBridge()) {
      const r = await ask('getAuthCode', { scopes: ['auth_user'] }, 60000);
      if (!r.ok || !r.authCode) { const e = new Error('M-Pesa login was cancelled'); e.code = 'login_failed'; throw e; }
      return r.authCode;
    }
    if (!A.phoneSignIn || !who || !who.phone) throw notInMpesa();
    return `mock:${who.phone}:${String(who.name || '').replace(/:/g, ' ')}`;
  };

  /** Opens the M-Pesa cashier. Resolves with the result code: 9000 paid, 8000/6004 processing, 6001 cancelled, 4000 failed. */
  A.tradePay = async function (paymentUrl) {
    const my = window.my;
    if (my && typeof my.tradePay === 'function') {
      return new Promise(res => my.tradePay({ paymentUrl, success: r => res(String(r.resultCode)), fail: r => res(String((r && r.resultCode) || '4000')) }));
    }
    if (await loadBridge()) return String((await ask('tradePay', { paymentUrl }, 15 * 60000)).resultCode || '4000');
    throw notInMpesa();
  };
  A.login = async function (authCode) {
    const r = await req('POST', '/v1/auth/mpesa', { authCode }, { noAuth: true });   // server exchanges the code with M-Pesa
    A.token = r.token;
    return { token: r.token, customer: r.customer };
  };
  A.logout = () => req('POST', '/v1/auth/logout').catch(() => {});
  A.me = () => req('GET', '/v1/me');
  /** recvBy 'email' | 'phone' (the app's words) → server 'email' | 'sms' */
  A.saveDelivery = (by, value) => req('PATCH', '/v1/me', by === 'phone' ? { deliverBy: 'sms', msisdn: value } : { deliverBy: 'email', email: value });
  A.saveLang = code => req('PATCH', '/v1/me', { lang: code });
  /** server customer → the app's session object */
  A.toSession = (c, token, prev) => Object.assign({}, prev || {}, {
    name: c.name || 'M-Pesa customer', phone: fmtPhone(c.msisdn), at: Date.now(), token,
    recvBy: c.delivery.by === 'sms' ? 'phone' : 'email',
    email: c.delivery.email || (prev && prev.email) || '',
    recvPhone: fmtPhone(c.delivery.msisdn || c.msisdn || '')
  });

  /* ---------------------------------------------------------------- orders */
  const PAID = ['paid', 'awaiting_stock', 'completed'];
  /** server order → app order. Partly delivered lines become a delivered line + a waiting line. */
  A.toAppOrder = function (o) {
    const items = [];
    o.items.forEach(it => {
      const base = { bid: it.brandId, region: 'ETH', amount: it.faceValueUsd, unit: it.unitPriceMinor / 100, sid: it.id };
      if (it.deliveredQuantity > 0) {
        items.push(Object.assign({}, base, {
          qty: it.deliveredQuantity, status: 'delivered', deliveredAt: ms(it.deliveredAt) || ms(o.paidAt),
          codes: it.codesHidden ? Array.from({ length: it.deliveredQuantity }, () => 'SHOWN ON THE PHONE THAT BOUGHT IT') : it.codes.map(c => c.code),
          codeIds: it.codesHidden ? [] : it.codes.map(c => c.id), usedAt: it.codesHidden ? [] : it.codes.map(c => ms(c.usedAt))
        }));
      }
      const left = it.quantity - it.deliveredQuantity;
      if (left > 0 && it.status === 'waiting') items.push(Object.assign({}, base, { qty: left, status: 'waiting', codes: [], eta: dayMs(it.eta) }));
    });
    return {
      id: o.reference, sid: o.id, at: ms(o.createdAt), name: '', phone: '',
      deliverBy: o.delivery.by === 'sms' ? 'phone' : 'email',
      email: o.delivery.by === 'email' ? o.delivery.to : '', smsTo: o.delivery.by === 'sms' ? fmtPhone(o.delivery.to) : '',
      total: o.totalMinor / 100, status: o.status, receipt: o.payment && o.payment.receipt, items
    };
  };
  A.orders = async () => (await req('GET', '/v1/orders?full=1')).orders.filter(o => PAID.includes(o.status)).map(A.toAppOrder);
  A.markUsed = (codeId, used) => req('POST', `/v1/codes/${codeId}/used`, { used });

  /**
   * Checkout: create the order, ask M-Pesa for the payment, wait for the answer.
   * lines: [{ productId, quantity }]. Resolves with the server order once paid; rejects with err.code
   * ('payFailed', 'payTimeout', or a server code such as 'emailInvalid').
   */
  A.checkout = async function (lines, delivery, lang, onStage) {
    const key = 'app-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    const order = await req('POST', '/v1/orders', {
      items: lines, deliverBy: delivery.by === 'phone' ? 'sms' : 'email', deliverTo: delivery.to, lang
    }, { headers: { 'idempotency-key': key } });
    const pay = await req('POST', `/v1/orders/${order.id}/pay`);
    onStage && onStage('pin', order);
    if (pay.clientAction && pay.clientAction.type === 'payWithMpesa') {   // M-Pesa Ethiopia H5: M-Pesa's own confirmation screen
      if (!(await loadSdk())) throw notInMpesa();
      const ca = pay.clientAction;
      const r = await myCall('payWithMpesa', { businessID: ca.businessID, billReference: ca.billReference, amount: ca.amount, currency: ca.currency, reason: ca.reason });
      const report = r.ok ? { paymentId: pay.id, status: 'success', transactionId: r.res.transactionId ? String(r.res.transactionId) : undefined }
        : { paymentId: pay.id, status: String(r.res.error) === '201' ? 'cancelled' : 'failed', error: r.res.error, errorMessage: r.res.errorMessage };
      await req('POST', `/v1/orders/${order.id}/pay-result`, report).catch(() => {});
      if (!r.ok) { const e = new Error(r.res.errorMessage || 'payment failed'); e.code = report.status === 'cancelled' ? 'payCancelled' : 'payFailed'; e.order = order; throw e; }
      // paid in M-Pesa: the server's confirmation from M-Pesa (C2B) decides below
    }
    if (pay.clientAction && pay.clientAction.type === 'tradePay') {   // M-Pesa mini program: the cashier opens in the app
      const code = await A.tradePay(pay.clientAction.paymentUrl);
      if (code === '6001') { const e = new Error('payment cancelled'); e.code = 'payCancelled'; e.order = order; throw e; }
      if (code === '4000') { const e = new Error('payment failed'); e.code = 'payFailed'; e.order = order; throw e; }
      // 9000 paid, 8000/6004/6002 not sure yet: the server's answer below decides
    }
    const until = Date.now() + 3 * 60 * 1000;
    let o = order;
    while (Date.now() < until) {
      await sleep(1500);
      o = await req('GET', `/v1/orders/${order.id}`).catch(() => o);
      if (PAID.includes(o.status)) {
        // give fulfilment a moment so codes are there when the person opens My Orders
        for (let i = 0; i < 6 && o.status === 'paid'; i++) { await sleep(1000); o = await req('GET', `/v1/orders/${order.id}`).catch(() => o); }
        return o;
      }
      if (o.payment && ['failed', 'cancelled', 'timeout'].includes(o.payment.status)) {
        const e = new Error(o.payment.message || 'payment failed'); e.code = 'payFailed'; e.order = o; throw e;
      }
    }
    const e = new Error('no answer from M-Pesa'); e.code = 'payTimeout'; e.order = o; throw e;
  };

  /* ---------------------------------------------------------------- wishlist */
  A.wishlist = async () => (await req('GET', '/v1/wishlist')).items.map(p => ({ bid: p.brandId, amount: p.faceValueUsd, at: ms(p.savedAt), wasOut: !!p.wasOutOfStock }));
  A.wishAdd = productId => req('PUT', `/v1/wishlist/${productId}`);
  A.wishRemove = productId => req('DELETE', `/v1/wishlist/${productId}`);

  /* ---------------------------------------------------------------- support */
  /** server ticket → app ticket. orderRefs maps server order id → reference shown to the customer. */
  A.toAppTicket = (x, orderRefs) => ({
    id: x.id, ref: x.reference, at: ms(x.created_at), topic: x.topic, status: x.status,
    orderId: x.order_id ? (orderRefs[x.order_id] || null) : null,
    msgs: (x.messages || []).map(m => ({ from: m.from, text: m.text, at: ms(m.at) })),
    custSeen: x.unread ? 0 : Date.now(), name: '', phone: ''
  });
  A.tickets = async orderRefs => (await req('GET', '/v1/support/tickets')).tickets.map(x => A.toAppTicket(x, orderRefs || {}));
  A.ticketCreate = (topic, text, orderSid) => req('POST', '/v1/support/tickets', { topic, text, orderId: orderSid || null });
  A.ticketReply = (id, text) => req('POST', `/v1/support/tickets/${id}/messages`, { text });
  A.ticketSeen = id => req('POST', `/v1/support/tickets/${id}/seen`);

  /* ================================================================ admin panel */
  A.adminLogin = async (email, password) => {
    const r = await req('POST', '/v1/admin/login', { email, password }, { noAuth: true });
    A.token = r.token;
    return r;
  };
  A.adminLogout = () => req('POST', '/v1/admin/logout').catch(() => {});

  /** server order (admin list) → the admin panel's order shape; codes arrive masked */
  A.toPanelOrder = o => {
    const items = [];
    (o.items || []).forEach(it => {
      const base = { bid: it.brandId, region: 'ETH', amount: Number(it.faceValueUsd), unit: it.unitPriceMinor / 100, sid: it.id };
      if (it.deliveredQuantity > 0) items.push(Object.assign({}, base, {
        qty: it.deliveredQuantity, status: 'delivered', deliveredAt: ms(it.deliveredAt) || ms(o.paid_at), codes: it.codes || [],
        via: it.provider ? { pid: it.provider, provider: it.provider } : undefined
      }));
      const left = it.quantity - it.deliveredQuantity;
      if (left > 0 && it.status === 'waiting') items.push(Object.assign({}, base, { qty: left, status: 'waiting', codes: [], eta: dayMs(it.eta) }));
    });
    return {
      id: o.reference, sid: o.id, at: ms(o.created_at), name: o.customer_name || '', phone: fmtPhone(o.msisdn),
      email: o.deliver_by === 'email' ? o.deliver_to : '', smsTo: o.deliver_by === 'sms' ? fmtPhone(o.deliver_to) : '',
      total: o.total_minor / 100, receipt: o.receipt, items
    };
  };
  A.toPanelTicket = x => ({
    id: x.id, ref: x.reference, at: ms(x.created_at), name: x.name || '', phone: fmtPhone(x.msisdn), email: '',
    topic: x.topic, status: x.status, orderId: x.order_reference || null,
    msgs: (x.messages || []).map(m => ({ from: m.from, text: m.text, at: ms(m.at) })), custSeen: ms(x.last_message_at)
  });

  /** Everything the admin panel shows, in its own shapes. orig = the panel's built-in brands. */
  A.adminLoad = async function (orig) {
    const [cat, settings, st, ords, tks] = await Promise.all([
      A.catalog(), req('GET', '/v1/admin/settings'), req('GET', '/v1/admin/stock'),
      req('GET', '/v1/admin/orders?full=1'), req('GET', '/v1/admin/tickets')
    ]);
    const r = A.fromCatalog(cat, orig);
    Object.assign(r.config, { lowAt: settings.low_stock_threshold, autoFulfil: settings.auto_fulfil, seller: settings.seller_name });
    const stock = {}, pidAll = {};
    st.products.forEach(p => {
      const k = `${p.brand_id}:${Number(p.face_value_usd)}`;
      pidAll[k] = p.id;
      stock[k] = { qty: p.codes_available, eta: dayMs(p.restock_eta), codes: [], owed: p.preorders_owed, active: p.is_active,
                   provider: p.provider_ready ? (p.providers || [])[0] || null : null };
    });
    return { config: r.config, stock, pid: pidAll, media: r.media, orders: ords.orders.map(A.toPanelOrder), tickets: tks.tickets.map(A.toPanelTicket) };
  };

  /* ---- direct admin actions */
  const MEDIA_KIND = { logos: 'logo', cards: 'card', banners: 'banner' };
  A.adminSetMedia = (kind, brandId, dataUrl) => req('PUT', `/v1/admin/brands/${brandId}/media/${MEDIA_KIND[kind]}`, { dataUrl });
  A.adminRemoveMedia = (kind, brandId) => req('DELETE', `/v1/admin/brands/${brandId}/media/${MEDIA_KIND[kind]}`);
  /** an order with its codes in full (admins only; every reveal is written to the audit log) */
  A.adminReveal = sid => req('GET', `/v1/admin/orders/${sid}?reveal=1`);
  A.adminOrder = sid => req('GET', `/v1/admin/orders/${sid}`);
  A.adminRetry = sid => req('POST', `/v1/admin/orders/${sid}/retry`);
  A.adminResend = sid => req('POST', `/v1/admin/orders/${sid}/resend`, {});
  A.adminUnpaid = async () => (await req('GET', '/v1/admin/orders/unpaid')).orders;
  A.adminRecordPayment = (sid, receipt, amountMinor) => req('POST', `/v1/admin/orders/${sid}/record-payment`, { receipt, amountMinor });
  A.adminProviders = async () => (await req('GET', '/v1/admin/providers')).providers;
  A.adminProviderSave = (id, body) => req('PUT', `/v1/admin/providers/${id}`, body);
  A.adminProviderSync = id => req('POST', `/v1/admin/providers/${id}/sync`);
  A.adminProviderProducts = async id => (await req('GET', `/v1/admin/providers/${id}/products`)).products;
  A.adminAutomap = (id, apply, addValues) => req('POST', `/v1/admin/providers/${id}/automap`, { apply: !!apply, addValues: !!addValues });
  A.adminMap = (productId, providerId, externalProductId, unitCostCents) => req('PUT', `/v1/admin/products/${productId}/sources/${providerId}`, { externalProductId, unitCostCents });
  A.adminUnmap = (productId, providerId) => req('DELETE', `/v1/admin/products/${productId}/sources/${providerId}`);
  A.adminProviderLog = async () => (await req('GET', '/v1/admin/providers/log')).calls;

  /**
   * Turns one admin change (the panel's data before and after) into API calls.
   * Returns { calls: [() => Promise], notes: [string] } — notes explain anything the live system does differently.
   */
  A.adminDiff = function (before, after, parts, pid) {
    const calls = [], notes = [];
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const iso = t => t ? new Date(t).toISOString().slice(0, 10) : null;

    if (parts.includes('stock')) {
      Object.keys(after.stock).forEach(k => {
        const a = after.stock[k], b = before.stock[k] || { qty: 0, eta: null, codes: [] };
        const id = pid[k]; if (!id) return;
        const fresh = (a.codes || []).slice((b.codes || []).length).filter(Boolean);
        // "CODE, PIN" or "CODE<tab>PIN" → { code, pin }; codes themselves may contain spaces
        const parsed = fresh.map(c => { const m = String(c).split(/\s*[,\t]\s*/); return m.length === 2 && m[1] ? { code: m[0], pin: m[1] } : String(c); });
        if (fresh.length) calls.push(() => req('POST', `/v1/admin/stock/${id}/codes`, { codes: parsed }).then(r => { if (r && r.rejected && r.rejected.length) notes.push(`${r.added} added · ${r.rejected.length} refused (already in stock or not valid)`); }));
        else if (a.qty !== b.qty) notes.push('Stock is the codes you upload: paste the codes to add stock.');   // safety net
        if (iso(a.eta) !== iso(b.eta) && !fresh.length) calls.push(() => req('PUT', `/v1/admin/stock/${id}/eta`, { eta: iso(a.eta) }));
      });
    }

    if (parts.includes('orders')) {
      const was = {}; before.orders.forEach(o => o.items.forEach((it, i) => { was[`${o.sid}:${it.sid}:${i}`] = it.status; }));
      const retry = new Set();
      after.orders.forEach(o => o.items.forEach((it, i) => { if (it.status === 'delivered' && was[`${o.sid}:${it.sid}:${i}`] === 'waiting') retry.add(o.sid); }));
      retry.forEach(sid => calls.push(() => req('POST', `/v1/admin/orders/${sid}/retry`)));
    }

    if (parts.includes('tickets')) {
      after.tickets.forEach(x => {
        const y = before.tickets.find(z => z.id === x.id); if (!y) return;
        const added = x.msgs.slice(y.msgs.length).filter(m => m.from === 'support');
        added.forEach((m, i) => calls.push(() => req('POST', `/v1/admin/tickets/${x.id}/reply`, { text: m.text, close: x.status === 'closed' && i === added.length - 1 })));
        if (!added.length && x.status !== y.status) calls.push(() => req('POST', `/v1/admin/tickets/${x.id}/status`, { status: x.status }));
      });
    }

    if (parts.includes('cfg')) {
      const c0 = before.cfg, c1 = after.cfg;
      const sp = {};
      if (c1.rate !== c0.rate) sp.usdEtbRate = c1.rate;
      if (c1.vat !== c0.vat) sp.vatRate = c1.vat;
      if (c1.seller !== c0.seller) sp.sellerName = c1.seller;
      if (c1.lowAt !== c0.lowAt) sp.lowStockThreshold = c1.lowAt;
      if (c1.autoFulfil !== c0.autoFulfil) sp.autoFulfil = c1.autoFulfil;
      if (!eq(c1.support, c0.support)) sp.support = c1.support;
      if (Object.keys(sp).length) calls.push(() => req('PATCH', '/v1/admin/settings', sp));

      // the values a brand actually sells, before and after
      const sells = (c, id) => { const bc = c.brands[id]; if (!bc || bc.on === false) return []; return (Array.isArray(bc.values) ? bc.values : c.values).filter(v => c.values.includes(v)); };
      const customOf = (c, id) => (c.custom || []).find(x => x.id === id);
      const ids = new Set([...Object.keys(c0.brands || {}), ...Object.keys(c1.brands || {}), ...(c1.custom || []).map(x => x.id), ...(c0.custom || []).map(x => x.id)]);
      ids.forEach(id => {
        const b0 = c0.brands[id] || {}, b1 = c1.brands[id] || {}, x0 = customOf(c0, id), x1 = customOf(c1, id);
        const patch = {};
        const src0 = x1 ? (x0 || {}) : b0, src1 = x1 || b1;   // custom brands keep their fields in cfg.custom
        [['name', 'name'], ['label', 'label'], ['mark', 'mark'], ['cat', 'category']].forEach(([k, f]) => { if (src1[k] !== undefined && src1[k] !== src0[k]) patch[f] = src1[k]; });
        if (src1.c1 && (src1.c1 !== src0.c1 || src1.c2 !== src0.c2 || src1.ink !== src0.ink)) Object.assign(patch, { color1: src1.c1, color2: src1.c2, ink: src1.ink, tile: src1.c1, tileInk: src1.ink });
        if (x1 && !x0) Object.assign(patch, { name: x1.name, mark: x1.mark || x1.name, category: x1.cat || 'card', color1: x1.c1, color2: x1.c2, ink: x1.ink, tile: x1.c1, tileInk: x1.ink, isActive: true });
        if (x0 && !x1) patch.isActive = false;
        const v0 = sells(c0, id), v1 = sells(c1, id);
        const add = v1.filter(v => !v0.includes(v)), drop = v0.filter(v => !v1.includes(v));
        if ((b1.on !== false) !== (b0.on !== false) && !(x0 && !x1)) patch.isActive = b1.on !== false;
        if (Object.keys(patch).length || add.length) calls.push(() => req('PUT', `/v1/admin/brands/${id}`, Object.assign(patch, add.length ? { valuesUsd: add } : {})));
        drop.forEach(v => { const p = pid[`${id}:${v}`]; if (p) calls.push(() => req('PATCH', `/v1/admin/products/${p}`, { isActive: false })); });
      });
      if (!eq(c1.popular, c0.popular) || !eq(c1.banners, c0.banners)) {
        calls.push(() => req('PUT', '/v1/admin/home', {
          popular: c1.popular,
          banners: c1.banners.map(b => ({ brandId: b.bid, title: b.title || null, accent: b.accent || null, active: b.on !== false }))
        }));
      }
    }
    return { calls, notes: [...new Set(notes)] };
  };

  window.EcardsAPI = A;
})();
