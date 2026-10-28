
(() => {
'use strict';

/* ================= settings ================= */
const CUR = { sym: 'Br', code: 'ETB' };   // Ethiopian Birr
const DEF_RATE = 265;                     // Birr per 1 US dollar (the admin panel can change it)
const CARD_VALUES = [50, 100, 150, 200];
const DEF_VAT = 0.15;                     // Ethiopia standard VAT, included in prices
const DEF_SELLER = 'eCards';
let RATE = DEF_RATE, VAT = DEF_VAT, SELLER = DEF_SELLER;

/* ================= helpers ================= */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n, d = 2) => CUR.sym + ' ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const priceOf = v => v * RATE;
const usd = v => '$' + Number(v).toLocaleString('en-US');
const fmtDate = ts => new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* browser storage, or memory when the viewer blocks it (some preview windows do) */
const MEM = new Map();
const LS = (() => { try { localStorage.setItem('__ec_t', '1'); localStorage.removeItem('__ec_t'); return true; } catch (e) { return false; } })();
const store = {
  get(k, d) {
    let v = null;
    if (MEM.has(k)) v = MEM.get(k); else if (LS) { try { v = localStorage.getItem(k); } catch (e) { v = null; } }
    try { return v ? JSON.parse(v) : d; } catch (e) { return d; }
  },
  set(k, v) { const t = JSON.stringify(v); if (LS) { try { localStorage.setItem(k, t); MEM.delete(k); return; } catch (e) { /* full or blocked */ } } MEM.set(k, t); },
  del(k) { MEM.delete(k); if (LS) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } } }
};
const K_ORDERS = 'ecards-et-v2-orders', K_CONFIG = 'ecards-et-v2-config', K_STOCK = 'ecards-et-v2-stock';   // shared with the mini app and the admin
/* the web store has its own sign-in and cart; orders, stock and settings are shared */
let session = store.get('ecards-web-session', null);
let cart = (store.get('ecards-web-cart', []) || []).filter(it => it && it.bid && it.qty > 0);

/* ================= data ================= */
const FLAG = { ETH: '🇪🇹' };
const CAT_ICON = { gaming: 'pad', apps: 'apps', video: 'play', music: 'note', telecom: 'signal', card: 'card' };
const ET = ['ETH'];
/* Each brand's tile and card share one tone, so a single logo file reads on both:
   white logo → netflix, xbox, playstation, spotify, pubg, razer, ecards · dark logo → apple, steam, cod · full colour → googleplay */
const BRANDS = [
  { id:'netflix', name:'Netflix', mark:'Netflix', cat:'video', c1:'#d6232d', c2:'#760a11', ink:'#fff', tile:'#e23440', tileInk:'#fff', regions:ET, amounts:CARD_VALUES },
  { id:'steam', name:'Steam', mark:'STEAM', ls:'.08em', light:true, band:'rgba(40,46,60,.45)', cat:'gaming', c1:'#f8f9fb', c2:'#d6dae2', ink:'#14171f', tile:'#eff0f3', tileInk:'#14171f', regions:ET, amounts:CARD_VALUES },
  { id:'xbox', name:'XBOX', mark:'XBOX', ls:'.02em', cat:'gaming', c1:'#3a3a3d', c2:'#0f0f11', ink:'#63c62d', tile:'#1d1d20', tileInk:'#63c62d', regions:ET, amounts:CARD_VALUES },
  { id:'playstation', name:'PlayStation', mark:'PlayStation', ms:.84, cat:'gaming', c1:'#2b56dc', c2:'#0a2276', ink:'#fff', tile:'#2149cf', tileInk:'#fff', regions:ET, amounts:CARD_VALUES },
  { id:'apple', name:'Apple & iTunes', label:'Apple', mark:'Apple', fw:700, light:true, band:'rgba(66,68,78,.42)', cat:'apps', c1:'#fdfdfe', c2:'#e1e3e9', ink:'#111', tile:'#f3f4f6', tileInk:'#111', regions:ET, amounts:CARD_VALUES },
  { id:'spotify', name:'Spotify', mark:'Spotify', cat:'music', c1:'#36c856', c2:'#0e7626', ink:'#fff', tile:'#1fb54c', tileInk:'#fff', regions:ET, amounts:CARD_VALUES },
  { id:'googleplay', name:'Google Play', mark:'Google Play', ms:.82, fw:600, light:true, band:'rgba(66,68,78,.42)', cat:'apps', c1:'#fcfcfd', c2:'#e2e4ea', ink:'#5b6068', tile:'#f3f4f6', tileInk:'#4c5158', regions:ET, amounts:CARD_VALUES },
  { id:'pubg', name:'PUBG Mobile', label:'PUBG', mark:'PUBG', ls:'.05em', cat:'gaming', c1:'#705a08', c2:'#2a2103', ink:'#f3bb1c', tile:'#3a2e05', tileInk:'#f3bb1c', regions:ET, amounts:CARD_VALUES },
  { id:'razer', name:'Razer Gold', label:'Razer Gold', mark:'RAZER', ls:'.22em', ms:.8, fw:700, cat:'gaming', c1:'#2e2e31', c2:'#0e0e0f', ink:'#47d82f', tile:'#1b1b1e', tileInk:'#47d82f', regions:ET, amounts:CARD_VALUES },
  { id:'cod', name:'Call of Duty', mark:'CALL OF DUTY', ms:.66, light:true, band:'rgba(40,36,24,.42)', cat:'gaming', c1:'#d3c8a8', c2:'#9a8c66', ink:'#151515', tile:'#d9d1bd', tileInk:'#1a1a1a', regions:ET, amounts:CARD_VALUES },
  { id:'ecards', name:'eCards', mark:'eCards', hidden:true, cat:'card', c1:'#da3431', c2:'#7a1013', ink:'#fff', tile:'#da3431', tileInk:'#fff', regions:ET, amounts:CARD_VALUES }
];
const BR = Object.fromEntries(BRANDS.map(b => [b.id, b]));
const POPULAR0 = ['netflix','steam','xbox','playstation','apple','spotify','googleplay','pubg','razer','cod'];
const ROWS0 = [
  { key:'rowTop', items:[['playstation',100],['playstation',50],['apple',50],['xbox',100],['netflix',100],['spotify',50],['steam',50]] },
  { key:'rowGaming', items:[['pubg',50],['razer',100],['cod',100],['steam',100],['xbox',50],['playstation',200]] },
  { key:'rowStreaming', items:[['netflix',50],['spotify',100],['googleplay',100],['apple',100],['googleplay',50]] }
].map(r => ({ ...r, items: r.items.map(([id, v]) => [id, v, 'ETH']) }));
const SLIDES0 = [
  { bid:'playstation', title:'PlayStation', accent:'#6f92ff', pal:['#1b3a99','#0d1d52','#3d6df2','#6f92ff','#162a66','#2a4fbf','#8d6cf0','#e9b949','#0a1336','#5a7bd8'] },
  { bid:'spotify', title:'Spotify', accent:'#36c856', pal:['#1db954','#0b4d22','#f59f74','#cfe86a','#2c2c54','#e85d8c','#178a42','#6e3ad6','#ffd166','#0e2b1a'] },
  { bid:'netflix', title:'Netflix', accent:'#e5303b', pal:['#7a1218','#c7343b','#e7a33a','#2f6f8f','#4b2a6b','#d9c6a3','#1f4a3a','#a33b6b','#3c3c3c','#e3d26f'] },
  { bid:'xbox', title:'XBOX', accent:'#63c62d', pal:['#1e7a1e','#0d2b0d','#5ec42a','#2b2b2b','#9bdc5c','#123d12','#444444','#c5e86c','#0a0a0a','#2f8f3a'] },
  { bid:'apple', title:'Apple', accent:'#ffffff', pal:['#e8e9ed','#9aa0aa','#ff6b5a','#4a90e2','#f5c242','#2b2d33','#7ad3a8','#c9cdd6','#a06bd8','#5b6070'] }
];
const SLIDE_BY = Object.fromEntries(SLIDES0.map(x => [x.bid, x]));
let POPULAR = POPULAR0, ROWS = ROWS0, SLIDES = SLIDES0;   // what the home screen shows, after the admin settings
const SPLASH = [ // brand, x%, y%, width%, flag
  ['apple',20.5,11,27,'ETH'], ['ecards',96,5,28,null], ['playstation',66,16.6,21,'ETH'],
  ['xbox',30,31.5,37,'ETH'], ['netflix',81,36,27,'ETH'], ['pubg',6,51,28,'ETH'],
  ['razer',91,56,23,null], ['googleplay',37.5,62,21,'ETH'], ['ecards',9,77,31,'ETH'],
  ['spotify',69,74.5,37,'ETH'], ['cod',35,92.5,37,'ETH'], ['netflix',78,91,27,'ETH']
];

/* ================= brand images =================
   Put your own licensed image files in an "assets" folder next to this HTML file.
   The app uses them automatically and keeps the built-in design for anything missing.
     assets/logos/<id>.png    brand logo, transparent PNG or SVG
     assets/cards/<id>.png    full gift card picture (optional; replaces the logo design on the card)
     assets/banners/<id>.jpg  home banner picture (netflix, playstation, spotify, xbox, apple)
   ids: netflix steam xbox playstation apple spotify googleplay pubg razer cod ecards
   To use files hosted elsewhere, put the full https:// link in ASSET_URLS instead. */
const ASSET_DIR = 'assets';
const ASSET_URLS = {
  logos:   { /* netflix: 'https://cdn.example.com/netflix-white.png' */ },
  cards:   { },
  banners: { }
};
const ASSET_EXT = { logos: ['png', 'svg', 'webp'], cards: ['png', 'jpg', 'webp'], banners: ['jpg', 'png', 'webp'] };
const HAVE = { logos: {}, cards: {}, banners: {} };    // what the screens use: admin uploads first, then files in the assets folder
const FOUND = { logos: {}, cards: {}, banners: {} };   // files found in the assets folder


const P = {
  chevL:'<path d="M15 5l-7 7 7 7"/>', chevR:'<path d="M9 5l7 7-7 7"/>', chevD:'<path d="M5 9l7 7 7-7"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16 16"/>',
  share:'<path d="M12 15V3.5"/><path d="M7.5 8L12 3.5 16.5 8"/><path d="M5 11.5V18a2.5 2.5 0 002.5 2.5h9A2.5 2.5 0 0019 18v-6.5"/>',
  cart:'<path d="M2.5 3.5h2.3l2.4 11.2a2 2 0 002 1.6h7.9a2 2 0 001.9-1.5L20.8 7.5H5.6"/><circle cx="9.8" cy="20" r="1.3"/><circle cx="17.2" cy="20" r="1.3"/>',
  pad:'<path d="M7.2 7.5h9.6a4.2 4.2 0 014.2 4.2v1.6a3.7 3.7 0 01-6.7 2.2L13.3 14h-2.6l-1 1.5A3.7 3.7 0 013 13.3v-1.6a4.2 4.2 0 014.2-4.2z"/><path d="M7.6 10.2v3.2M6 11.8h3.2"/><path d="M15.6 11h.01M17.6 13h.01" stroke-width="2.8"/>',
  apps:'<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  play:'<rect x="2.5" y="5" width="19" height="14" rx="3.5"/><path d="M10 9.3v5.4l4.6-2.7z" fill="currentColor"/>',
  note:'<path d="M9 18V6.2l11-2.2v11.8"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="15.8" r="2.5"/>',
  signal:'<path d="M4 19v-3M9 19v-6M14 19v-9M19 19V5"/>',
  card:'<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>',
  nonret:'<rect x="4" y="3.5" width="12" height="15" rx="2.5"/><path d="M7.5 7.5h5M7.5 11h3"/><circle cx="17" cy="17" r="4" fill="#fff"/><path d="M14.3 19.7l5.4-5.4"/>',
  send:'<path d="M3.8 4.6l16.7 7.4-16.7 7.4 2.9-7.4z" fill="currentColor" fill-opacity=".18"/><path d="M6.7 12h6.5"/>',
  agent:'<path d="M4.5 13v-1a7.5 7.5 0 0115 0v1"/><rect x="3" y="12" width="3.5" height="5.5" rx="1.5"/><rect x="17.5" y="12" width="3.5" height="5.5" rx="1.5"/><path d="M19.2 17.5c0 1.9-2 3-5 3h-1.7"/><path d="M9.5 12.5h.01M14.5 12.5h.01" stroke-width="2.6"/>',
  ticket:'<path d="M3.5 7.5a2 2 0 012-2h13a2 2 0 012 2v2a2.5 2.5 0 000 5v2a2 2 0 01-2 2h-13a2 2 0 01-2-2v-2a2.5 2.5 0 000-5z"/><path d="M14 6.5v11" stroke-dasharray="2 2.4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5" /><path d="M12 7.6v.01" stroke-width="2.8"/>',
  doc:'<path d="M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 015 19V5a1.5 1.5 0 011.5-1.5z"/><path d="M13.5 3.5V8H18M8.5 13h7M8.5 16.5h5"/>',
  store:'<path d="M4.5 10v9a1.5 1.5 0 001.5 1.5h12a1.5 1.5 0 001.5-1.5v-9"/><path d="M3 9.5L5 4h14l2 5.5a3 3 0 01-6 0 3 3 0 01-6 0 3 3 0 01-6 0z"/><path d="M10 20.5v-5h4v5"/>',
  trash:'<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.8 12.2a1.5 1.5 0 001.5 1.3h6.4a1.5 1.5 0 001.5-1.3L17.5 7"/>',
  minus:'<path d="M6 12h12"/>', plus:'<path d="M12 6v12M6 12h12"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy:'<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  wallet:'<rect x="3" y="5.5" width="18" height="14" rx="3"/><path d="M3 9.5h18"/><path d="M15.5 14.5h2.5"/>',
  swap:'<path d="M5 8.5h13l-3-3M19 15.5H6l3 3"/>',
  close:'<path d="M6 6l12 12M18 6L6 18"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  mail:'<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M4 7.5l8 5.5 8-5.5"/>',
  eyeOff:'<path d="M3 3l18 18"/><path d="M10.6 5.6A9.7 9.7 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 01-3.2 4M6.3 6.8C3.9 8.5 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.2 9.2 0 004.4-1.1"/><path d="M9.9 10a3 3 0 004.1 4.2"/>'
};
const BOLT_LINE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.6 2.5L5.4 13.6h5.3l-1.3 7.9 8.8-11.8h-5.5z" fill="#a43ad6"/></svg>';
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;
Object.assign(P, {
  heart:'<path d="M12 20.3s-7.6-4.6-7.6-10.2A4.3 4.3 0 0112 7.4a4.3 4.3 0 017.6 2.7c0 5.6-7.6 10.2-7.6 10.2z"/>',
  heartF:'<path d="M12 20.3s-7.6-4.6-7.6-10.2A4.3 4.3 0 0112 7.4a4.3 4.3 0 017.6 2.7c0 5.6-7.6 10.2-7.6 10.2z" fill="currentColor"/>',
  hourglass:'<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M8 3.5c0 4.2 4 5 4 8.5s-4 4.3-4 8.5M16 3.5c0 4.2-4 5-4 8.5s4 4.3 4 8.5"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
  logout:'<path d="M9.5 20.5H6a2 2 0 01-2-2v-13a2 2 0 012-2h3.5"/><path d="M15.5 16.5L20 12l-4.5-4.5M20 12H9.5"/>',
  phone:'<path d="M5.2 3.8h3.2l1.6 4.1-2.1 1.4a11.5 11.5 0 005.8 5.8l1.4-2.1 4.1 1.6v3.2a2 2 0 01-2.1 2A16.4 16.4 0 013.2 5.9a2 2 0 012-2.1z"/>',
  chat:'<path d="M20.5 11.6a8.4 8.4 0 01-12.3 7.5L3.5 20.4l1.3-4.4A8.4 8.4 0 1120.5 11.6z"/><path d="M8.6 10.4h6.8M8.6 13.6h4.4"/>',
  reset:'<path d="M4.5 12a7.5 7.5 0 107.5-7.5c-2.4 0-4.5 1-6 2.8"/><path d="M5.5 3.5v4h4"/>'
});
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;

const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6.5" fill="#b63ae2"/><path d="M13.3 4.6L7.2 13.1h4.2l-1 6.3 6.4-9h-4.3z" fill="#fff"/></svg>';

/* ================= gift card package ================= */
const SHELL = 'M42 0H280Q300 0 300 20V250Q300 270 280 270H20Q0 270 0 250V42Q0 37 4 33L33 4Q37 0 42 0Z';
const HOLE = 'M110.5 24H131.6Q134 24 134.4 21.6A17 17 0 0 1 167.6 21.6Q168 24 170.4 24H191.5A8.5 8.5 0 0 1 191.5 41H110.5A8.5 8.5 0 0 1 110.5 24Z';   // hanger hole: pill-shaped slot with a round bump
document.getElementById('shellClipPath').setAttribute('d', SHELL);

const logoImg = b => `<img class="logo" src="${esc(HAVE.logos[b.id])}" alt="${esc(b.name)}" draggable="false">`;
function pkg(bid, value, region, alt, pre) {
  const b = BR[bid];
  const art = HAVE.cards[b.id];
  const vars = `--c1:${b.c1};--c2:${b.c2};--mk:${b.ink};--ms:${b.ms || 1};--ls:${b.ls || '-.01em'};--fw:${b.fw || 800}${b.band ? ';--band:' + b.band : ''}`;
  const face = art
    ? `<img class="art" src="${esc(art)}" alt="${esc(b.name)}" draggable="false">`
    : `<div class="mark">${HAVE.logos[b.id] ? logoImg(b) : `${ic(CAT_ICON[b.cat])}<span>${esc(b.mark)}</span>`}</div>`;
  return `<div class="pkg">`
    + `<svg class="shell" viewBox="0 0 300 270" preserveAspectRatio="none" aria-hidden="true">`
    + `<path d="${SHELL}" fill="url(#${alt ? 'shellB' : 'shellA'})"/><path d="${HOLE}" fill="url(#holeG)"/>`
    + `<g clip-path="url(#shellClip)" fill="none" stroke="#fff" stroke-linecap="round"><path d="M212 -6L306 82" stroke-opacity=".95" stroke-width="1.4"/><path d="M231 -6L306 64" stroke-opacity=".5" stroke-width="6"/><path d="M252 -6L306 45" stroke-opacity=".7" stroke-width="1"/></g>`
    + `<path d="${SHELL}" fill="none" stroke="#7d86b5" stroke-opacity=".22" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`
    + `<div class="gcard${b.light ? ' light' : ''}${art ? ' has-art' : ''}" style="${vars}">`
    + face
    + `<div class="band"><span class="val">${value != null ? usd(value) : ''}</span>${pre ? `<span class="pre-pill">${'Pre-order'}</span>` : ''}</div>`
    + `</div></div>`;
}
const tile = b => `<span class="tile" style="background:${b.tile};color:${b.tileInk}">${HAVE.logos[b.id] ? logoImg(b) : `${ic(CAT_ICON[b.cat])}<span class="tname" style="letter-spacing:${b.ls || '.01em'};font-weight:${b.fw || 800}">${esc(b.mark)}</span>`}</span>`;

/* find the user's image files once at start-up, so screens render with or without them */
function tryLoad(url) {
  return new Promise(res => {
    const im = new Image(); const tm = setTimeout(() => res(false), 4000);
    im.onload = () => { clearTimeout(tm); res(im.naturalWidth > 0); };
    im.onerror = () => { clearTimeout(tm); res(false); };
    im.src = url;
  });
}
async function findAsset(kind, id) {
  const urls = ASSET_URLS[kind][id] ? [ASSET_URLS[kind][id]] : ASSET_EXT[kind].map(e => `${ASSET_DIR}/${kind}/${id}.${e}`);
  for (const u of urls) { if (await tryLoad(u)) { FOUND[kind][id] = u; return; } }
}
function probeAssets() {
  const jobs = [];
  BRANDS.forEach(b => { jobs.push(findAsset('logos', b.id), findAsset('cards', b.id)); });
  BRANDS.forEach(b => jobs.push(findAsset('banners', b.id)));
  return Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 2500))]);
}


function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const g = () => Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  return `DEMO-${g()}-${g()}-${g()}`;
}

/* ---------- shared with the admin panel: settings, stock and every customer's orders ----------
   Keep defaultConfig, defaultStockEntry and fulfilWaiting the same as in admin.html. */
const DAY = 86400000;
const DAY0 = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const STOCK_SEED = { 'netflix:100': 2, 'playstation:50': 1, 'spotify:150': 3, 'steam:100': 2, 'apple:200': 4, 'pubg:*': 2, 'googleplay:150': 5 };   // starts out of stock: days until the restock
/* brands: the admin can rename them, recolour them and add new ones */
const CATS = ['gaming', 'apps', 'video', 'music', 'telecom', 'card'];
const HEX = /^#[0-9a-f]{6}$/i;
const BRAND_KEYS = ['name', 'label', 'mark', 'cat', 'c1', 'c2', 'ink', 'tile', 'tileInk', 'light', 'band', 'ms', 'ls', 'fw', 'wallet'];
const ORIG = Object.fromEntries(BRANDS.map(b => [b.id, Object.fromEntries(BRAND_KEYS.map(k => [k, b[k]]))]));
function lightHex(hex) { const n = parseInt(String(hex).slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255 > 0.6; }
function mixHex(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function colourBrand(b, c1, c2, ink) {
  b.c1 = c1; b.c2 = c2; b.ink = ink; b.tile = c1; b.tileInk = ink;
  b.light = lightHex(c1); b.band = b.light ? 'rgba(40,46,60,.42)' : undefined; b.wallet = [c1, c2, ink];
}
function applyBrands(c) {
  for (let i = BRANDS.length - 1; i >= 0; i--) if (BRANDS[i].custom) { delete BR[BRANDS[i].id]; BRANDS.splice(i, 1); }
  (Array.isArray(c.custom) ? c.custom : []).forEach(x => {
    if (!x || !/^[a-z0-9-]{2,40}$/.test(x.id) || BR[x.id] || !x.name) return;
    const b = { id: x.id, custom: true, name: String(x.name).slice(0, 40), label: x.label ? String(x.label).slice(0, 24) : '', mark: String(x.mark || x.name).slice(0, 24), cat: CATS.includes(x.cat) ? x.cat : 'card', regions: ['ETH'], amounts: CARD_VALUES };
    colourBrand(b, HEX.test(x.c1) ? x.c1 : '#3b4a6b', HEX.test(x.c2) ? x.c2 : '#1c2438', HEX.test(x.ink) ? x.ink : '#ffffff');
    const hi = BRANDS.findIndex(y => y.hidden);
    BRANDS.splice(hi < 0 ? BRANDS.length : hi, 0, b); BR[b.id] = b;
  });
  BRANDS.forEach(b => {
    if (b.hidden) return;
    if (!b.custom) BRAND_KEYS.forEach(k => { b[k] = ORIG[b.id][k]; });
    const o = (c.brands && c.brands[b.id]) || {};
    if (o.name) b.name = String(o.name).slice(0, 40);
    if (o.label != null) b.label = String(o.label).slice(0, 24);
    if (o.mark) b.mark = String(o.mark).slice(0, 24);
    if (CATS.includes(o.cat)) b.cat = o.cat;
    if (HEX.test(o.c1) && HEX.test(o.c2) && HEX.test(o.ink)) colourBrand(b, o.c1, o.c2, o.ink);
    if (b.custom || o.mark) { b.ms = Math.min(1, 9 / Math.max(1, b.mark.length)); b.ls = undefined; b.fw = undefined; }
  });
}
/* a home banner can be made for any brand; the five built-in ones keep their artwork */
function slideOf(x) {
  const b = BR[x.bid], base = SLIDE_BY[x.bid];
  const pal = base ? base.pal : [b.c1, b.c2, mixHex(b.c1, '#ffffff', .3), mixHex(b.c2, '#000000', .35), mixHex(b.c1, b.c2, .5), mixHex(b.c1, '#000000', .5), mixHex(b.c2, '#ffffff', .25), b.c1, b.c2, mixHex(b.c1, '#808080', .45)];
  return { bid: x.bid, title: x.title ? String(x.title).slice(0, 30) : (base ? base.title : (b.label || b.name)), accent: HEX.test(x.accent) ? x.accent : (base ? base.accent : b.c1), pal };
}
const wallSeed = bid => { const i = SLIDES0.findIndex(x => x.bid === bid); return 11 + (i >= 0 ? i : 5 + hashStr(bid) % 40) * 7; };   // same artwork for a brand wherever it shows
function defaultConfig() {
  return {
    rate: DEF_RATE, vat: DEF_VAT, seller: DEF_SELLER, values: CARD_VALUES.slice(), lowAt: 5, autoFulfil: true,
    brands: Object.fromEntries(BRANDS.filter(b => !b.hidden && !b.custom).map(b => [b.id, { on: true, values: CARD_VALUES.slice() }])),
    custom: [],
    support: { phone: '', email: 'support@example.com', telegram: '', whatsapp: '', from: '08:00', to: '22:00' },
    popular: POPULAR0.slice(),
    banners: SLIDES0.map(x => ({ bid: x.bid, on: true }))
  };
}
function loadConfig() {
  const d = defaultConfig(), sv = store.get(K_CONFIG, null);
  if (!sv || typeof sv !== 'object') { applyBrands(d); return d; }
  const c = { ...d, ...sv };
  c.rate = +c.rate > 0 ? +c.rate : d.rate;
  c.vat = +c.vat >= 0 && +c.vat < 1 ? +c.vat : d.vat;
  c.lowAt = +c.lowAt >= 0 ? +c.lowAt : d.lowAt;
  c.values = Array.isArray(c.values) && c.values.length ? [...new Set(c.values.map(Number).filter(v => v > 0))].sort((a, b) => a - b) : d.values;
  c.brands = { ...d.brands, ...(sv.brands || {}) };
  c.custom = Array.isArray(sv.custom) ? sv.custom : [];
  c.support = { ...d.support, ...(sv.support && typeof sv.support === 'object' ? sv.support : {}) };
  applyBrands(c);
  c.popular = Array.isArray(sv.popular) ? sv.popular.filter(id => BR[id] && !BR[id].hidden) : d.popular;
  c.banners = Array.isArray(sv.banners) ? sv.banners.filter(x => x && BR[x.bid] && !BR[x.bid].hidden) : d.banners;
  SLIDES0.forEach(x => { if (!c.banners.some(y => y.bid === x.bid)) c.banners.push({ bid: x.bid, on: false }); });
  return c;
}
function hashStr(str) { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
function defaultStockEntry(bid, v) {
  if (!ORIG[bid] || !CARD_VALUES.includes(+v)) return { qty: 0, eta: null, codes: [] };   // brands and values added later start empty
  const d = STOCK_SEED[`${bid}:${v}`] ?? STOCK_SEED[`${bid}:*`];
  if (d != null) return { qty: 0, eta: DAY0 + d * DAY, codes: [] };
  const r = mulberry32(hashStr(`${bid}:${v}`))();
  return { qty: r < .15 ? 2 + Math.floor(r * 20) : 8 + Math.floor(r * 40), eta: null, codes: [] };
}
function loadStock(c) {
  const sv = store.get(K_STOCK, null), st = sv && typeof sv === 'object' ? sv : {};
  let changed = !sv;
  BRANDS.filter(b => !b.hidden).forEach(b => c.values.forEach(v => {
    const k = `${b.id}:${v}`;
    if (!st[k] || typeof st[k].qty !== 'number') { st[k] = defaultStockEntry(b.id, v); changed = true; }
    if (!Array.isArray(st[k].codes)) st[k].codes = [];
  }));
  if (changed) store.set(K_STOCK, st);
  return st;
}
let cfg = null, stock = {}, allOrders = [], orders = [];   // orders: only this customer's
const mine = o => !o.phone || (session && o.phone === session.phone);
function applyCfg() {
  RATE = cfg.rate; VAT = cfg.vat; SELLER = cfg.seller || DEF_SELLER;
  BRANDS.forEach(b => {
    if (b.hidden) return;
    const bc = cfg.brands[b.id] || { on: true, values: cfg.values };
    const vals = cfg.values.filter(v => (Array.isArray(bc.values) ? bc.values : cfg.values).includes(v));
    b.off = !bc.on || !vals.length;
    b.amounts = vals.length ? vals : cfg.values.slice();
  });
  const live = id => BR[id] && !BR[id].hidden && !BR[id].off;
  POPULAR = cfg.popular.filter(live);
  ROWS = ROWS0.map(r => ({ ...r, items: r.items.filter(([id, v]) => live(id) && BR[id].amounts.includes(v)) })).filter(r => r.items.length);
  const sl = cfg.banners.filter(x => x.on && live(x.bid)).map(slideOf);
  SLIDES = sl.length ? sl : [slideOf({ bid: SLIDES0[0].bid })];
}

/* ---------- pictures uploaded in the admin panel: they replace files from the assets folder ---------- */
const K_MEDIA = 'ecards-et-v2-media';
const IMG_URL = /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/;
function loadMedia() {
  const m = store.get(K_MEDIA, null) || {};
  ['logos', 'cards', 'banners'].forEach(k => {
    const up = Object.fromEntries(Object.entries(m[k] || {}).filter(([, v]) => typeof v === 'string' && IMG_URL.test(v)));
    HAVE[k] = { ...FOUND[k], ...up };
  });
}

/* ---------- gift card API providers (shared by the app and the admin; the same in both files) ----------
   DEMO: no provider is contacted. Calls are simulated and written to the API log so the flow can be followed.
   In the live system these calls run on the eCards server, never in the browser, and keys stay on the server. */
const K_API = 'ecards-et-v2-api';
function loadApi() {
  const a = store.get(K_API, null) || {};
  return {
    providers: Array.isArray(a.providers) ? a.providers.filter(p => p && p.id) : [],
    products: Array.isArray(a.products) ? a.products.filter(p => p && p.key) : [],
    sell: a.sell && typeof a.sell === 'object' ? a.sell : {},
    log: Array.isArray(a.log) ? a.log : []
  };
}
const saveApi = A => store.set(K_API, A);
const provOf = (A, id) => A.providers.find(p => p.id === id);
const provReady = p => !!p && p.on !== false && p.status === 'ok';
function apiFor(A, bid, v) {   // the provider product that delivers this brand and value, when it can sell right now
  const s = A.sell[`${bid}:${v}`]; if (!s) return null;
  const p = provOf(A, s.pid); if (!provReady(p)) return null;
  return { s, p };
}
const apiReady = (A, bid, v, qty = 1) => { const x = apiFor(A, bid, v); return !!x && x.p.balance >= x.s.cost * qty; };
function apiLog(A, e) { A.log.unshift({ at: Date.now(), ...e }); if (A.log.length > 250) A.log.length = 250; }
const apiMs = () => 140 + Math.floor(Math.random() * 520);
const apiPath = (p, k, vars = {}) => String((p.paths && p.paths[k]) || k).replace(/\{(\w+)\}/g, (m, n) => vars[n] ?? m);
/* buy cards for one order line: order, then fetch the codes. Returns { codes, via } or null (line stays a pre-order) */
function apiBuy(A, line, ref, src) {
  const x = apiFor(A, line.bid, line.amount); if (!x) return null;
  const { s, p } = x, cost = +(s.cost * line.qty).toFixed(2);
  if (p.balance < cost) {
    apiLog(A, { pid: p.id, src, m: 'POST', p: apiPath(p, 'order'), s: 400, ms: apiMs(), err: true, note: `${ref} · not enough balance: needs $${cost.toFixed(2)}, has $${p.balance.toFixed(2)} · kept as a pre-order` });
    return null;
  }
  const txn = String(100000 + Math.floor(Math.random() * 899999));
  p.balance = +(p.balance - cost).toFixed(2);
  apiLog(A, { pid: p.id, src, m: 'POST', p: apiPath(p, 'order'), s: 200, ms: apiMs(), note: `customIdentifier ${ref} · product ${s.product} · ${line.qty} × $${line.amount} · SUCCESSFUL · transaction ${txn} · cost $${cost.toFixed(2)}` });
  apiLog(A, { pid: p.id, src, m: 'GET', p: apiPath(p, 'codes', { id: txn }), s: 200, ms: apiMs(), note: `${line.qty} code${line.qty === 1 ? '' : 's'} received · codes are never written to the log` });
  return { codes: Array.from({ length: line.qty }, makeCode), via: { pid: p.id, provider: p.name, txn, cost } };
}
let api = { providers: [], products: [], sell: {}, log: [] };
function loadShared() {
  cfg = loadConfig(); applyCfg();
  api = loadApi();
  stock = loadStock(cfg);
  allOrders = (store.get(K_ORDERS, []) || []).filter(o => o && Array.isArray(o.items));
  if (noRefunds(allOrders)) store.set(K_ORDERS, allOrders);
  orders = allOrders.filter(mine);
}
/* there are no refunds: demo data saved by an older version may still hold refunded lines */
function noRefunds(list) {
  let changed = false;
  list.forEach(o => o.items.forEach(it => {
    if (it.status !== 'refunded') return;
    changed = true; delete it.refundedAt;
    if (o.sample) { it.status = 'delivered'; it.codes = Array.from({ length: it.qty }, makeCode); it.deliveredAt = o.at; }
    else { it.status = 'waiting'; it.codes = []; it.eta = it.eta || DAY0 + 3 * DAY; }
  }));
  return changed;
}
const saveOrders = () => { store.set(K_ORDERS, allOrders); orders = allOrders.filter(mine); };
const saveStock = () => store.set(K_STOCK, stock);
loadShared();
loadMedia();
cart = cart.filter(it => it && BR[it.bid] && !BR[it.bid].hidden && !BR[it.bid].off && BR[it.bid].amounts.includes(it.amount));   // drop anything the admin stopped selling


/* ---------- stock ---------- */
const skey = (bid, v) => `${bid}:${v}`;
const stockOf = (bid, v) => { const x = stock[skey(bid, v)]; return (x ? Math.max(0, x.qty) : 0) + (apiReady(api, bid, v) ? 999 : 0); };   // a connected provider means always in stock
const isOut = (bid, amount) => stockOf(bid, amount) <= 0;
const etaOf = (bid, amount) => { const x = stock[skey(bid, amount)]; return Math.max(x && x.eta ? x.eta : DAY0 + 3 * DAY, DAY0 + DAY); };
const isLow = (bid, amount) => !isOut(bid, amount) && stockOf(bid, amount) <= cfg.lowAt;
const capOf = it => isOut(it.bid, it.amount) ? 10 : Math.min(10, stockOf(it.bid, it.amount));   // most a cart line can hold
const unitOf = it => it.unit != null ? it.unit : priceOf(it.amount);   // price paid per card (kept on the order)
const vatPct = () => +(VAT * 100).toFixed(2);
const dmy = ts => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
function takeCodes(x, n) { const out = x.codes.splice(0, n); while (out.length < n) out.push(makeCode()); return out; }
/* oldest pre-orders first; a line is delivered only when its whole quantity is in stock */
function fulfilWaiting(onlyKey) {
  let n = 0;
  allOrders.slice().sort((a, b) => a.at - b.at).forEach(o => o.items.forEach(it => {
    if (it.status !== 'waiting') return;
    const k = skey(it.bid, it.amount); if (onlyKey && k !== onlyKey) return;
    const x = stock[k]; if (!x || x.qty < it.qty) return;
    x.qty -= it.qty; it.codes = takeCodes(x, it.qty); it.status = 'delivered'; it.deliveredAt = Date.now(); n++;
  }));
  return n;
}


/* Forms work everywhere: some preview windows block real form submission, so Save/Send buttons and the
   Enter key raise the submit event themselves (nothing is ever sent anywhere; the handlers stay the same). */
(() => {
  const fire = f => {
    if (!f.noValidate && !f.checkValidity()) { f.reportValidity(); return; }
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };
  const NO_ENTER = /^(checkbox|radio|file|button|submit|reset|color|range|image)$/;
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button, input[type="submit"]');
    if (!b || b.disabled || !b.form || (b.type || '').toLowerCase() !== 'submit') return;
    e.preventDefault(); fire(b.form);
  }, true);
  document.addEventListener('keydown', e => {
    const el = e.target;
    if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented || el.tagName !== 'INPUT' || !el.form || NO_ENTER.test(el.type)) return;
    if (!el.form.querySelector('button[type="submit"]:not([disabled]), input[type="submit"]:not([disabled])')) return;
    e.preventDefault(); fire(el.form);
  });
})();

const WEB_I18N = {};
WEB_I18N.en = {
  homeAria: 'eCards home', navGift: 'Gift cards', navHow: 'How it works', navHelp: 'Help', mainNav: 'Main',
  searchLbl: 'Search gift cards', searchPh: 'Search Netflix, PlayStation…', search: 'Search',
  myOrders: 'My orders', helpContact: 'Help and contact', signOut: 'Sign out', signIn: 'Sign in', cartAria: 'Cart, {n}', language: 'Language',
  footBlurb: 'Digital gift cards for Ethiopia, priced in Birr with VAT included. Pay with M-Pesa and get your code by SMS or email. Also available inside the M-Pesa app.',
  shop: 'Shop', allCards: 'All gift cards', qa: 'Questions and answers', contactUs: 'Contact us', everyDay: 'Every day {from}–{to}', legal: 'Legal',
  terms: 'Terms of service', privacy: 'Privacy policy', norefund: 'No-refund policy',
  footPrices: 'Prices in Ethiopian Birr (ETB), VAT included', footDemo: 'Demo store: no real payments, SMS or codes',
  cat_gaming: 'Gaming', cat_apps: 'Apps', cat_video: 'Streaming', cat_music: 'Music', cat_telecom: 'Mobile top-up', cat_card: 'Gift cards', catAll: 'All', category: 'Category',
  preorder: 'Pre-order', instant: 'Instant', onlyLeft: 'Only {n} left', from: 'From', cardAria: '{name} gift card, from {price}',
  eyebrow: 'Instant delivery · pay with M-Pesa', heroH: 'Gift cards for the games, music and shows you love',
  heroP: 'Netflix, PlayStation, Spotify, Steam and more, priced in Birr with VAT included. Pay with M-Pesa and get your code by SMS or email in seconds.',
  browse: 'Browse gift cards', pt1: 'Codes in seconds', pt2: 'Prices in Birr, VAT included', pt3: 'Support every day',
  popular: 'Popular brands', seeAll: 'See all gift cards', shopBrand: 'Shop {brand} gift cards', giftCards: 'Gift cards',
  howSub: 'Three steps, usually under a minute.',
  s1h: '1. Choose a card', s1p: 'Pick the brand and the value. Prices are in Birr and already include {vat}% VAT.',
  s2h: '2. Pay with M-Pesa', s2p: 'Enter your M-Pesa number. Approve the payment on your phone with your PIN.',
  s3h: '3. Get your code', s3p: 'Your code shows on screen and in My orders, and we send it by SMS or email.',
  tr1h: 'Instant delivery', tr1p: 'Cards in stock arrive seconds after payment.', tr2h: 'Secure M-Pesa payment', tr2p: 'You approve every payment on your own phone.',
  tr3h: 'VAT included', tr3p: 'The price you see is the price you pay.', tr4h: 'Help every day', tr4p: '{from}–{to} by phone, Telegram or email.', tr4p0: 'By phone, Telegram or email.',
  noFound: 'No gift cards found', noMatch: 'Nothing matches “{q}”.', noMatchIn: 'Nothing matches “{q}” in {cat}.', tryAnother: 'Try another name or category.', showAll: 'Show all gift cards',
  allSub: '{n} brands · digital codes delivered by SMS or email', searchBrands: 'Search brands', sort: 'Sort', sortPop: 'Most popular', sortPrice: 'Lowest price', sortAz: 'Name A–Z',
  naH: 'This gift card isn’t available', naP: 'It may have been removed from the store.', crumbHome: 'Home', crumbs: 'Breadcrumb',
  cardTitle: '{name} gift card', pdSub: 'Digital code · delivered by SMS or email · for use in Ethiopia', chooseVal: 'Choose a value', vatIncl: 'VAT included ({vat})',
  avPreB: 'Out of stock, available to pre-order.', avPre: 'You pay now and we send your code as soon as it arrives, expected by {date}.',
  avLowB: 'Only {n} left.', avLow: 'Delivered instantly after payment.', avOkB: 'In stock.', avOk: 'Your code is delivered seconds after payment.',
  qty: 'Quantity', less: 'One less', more: 'One more', addCart: 'Add to cart', buyNow: 'Buy now', preNow: 'Pre-order now',
  n1: 'Pay with M-Pesa from any Ethiopian mobile number.', n2: 'We send the code by SMS or email, and it stays in My orders.', n3: 'Digital codes can’t be returned or refunded once delivered. Check the value before you pay.',
  redeemH: 'How to use your {brand} code', r1: 'Open {brand} on your phone, console or computer and sign in to your account.',
  r2: 'Go to the place for gift cards or codes (often called Redeem, Add funds or Gift card).', r3: 'Type in the code exactly as shown. The value is added to your balance straight away.',
  alsoLike: 'You might also like',
  cartH: 'Your cart', cartEmptyH: 'Your cart is empty', cartEmptyP: 'Add a gift card and it will show up here.', cards1: '1 card', cardsN: '{n} cards',
  each: '{price} each · VAT included', qtyOf: 'Quantity of {name}', remove: 'Remove', preExp: 'Pre-order · expected by {date}',
  summary: 'Summary', subtotal: 'Subtotal', vatPctL: 'VAT included ({vat}%)', delivery: 'Delivery', deliveryFree: 'Free · SMS or email', total: 'Total',
  checkout: 'Check out', signToCheck: 'Sign in to check out', payWith: 'Pay with', preFine: 'Pre-order cards are paid now and sent when they arrive.', noRefundFine: 'Digital codes can’t be refunded once delivered.',
  showCode: 'Show code', hideCode: 'Hide code', copyCode: 'Copy code',
  signSeeH: 'Sign in to see your orders', signSeeP: 'Use the phone number you paid with. Your codes are saved there.', noOrdersH: 'No orders yet', noOrdersP: 'Gift cards you buy show up here with their codes.',
  signedAs: 'Signed in as {name} · {phone}', stDelivered: 'Delivered', stPartly: 'Partly delivered', stWaiting: 'Waiting for stock', mpesaApp: 'M-Pesa app',
  expBy: 'Expected by {date}', paidWait: 'Paid. We send the code as soon as the card is in stock.', paidMpesa: 'Paid with M-Pesa', sentSms: 'Codes sent by SMS to {to}', sentMail: 'Codes sent to {to}', cardOf: '{v} card',
  helpSub: 'Answers to common questions, ways to reach us, and our policies.', call: 'Call us', emailL: 'Email',
  q1: 'How fast do I get my code?', a1: 'Cards in stock are delivered seconds after you approve the M-Pesa payment. The code shows on screen, in My orders, and by SMS or email.',
  q2: 'How do I pay?', a2: 'With M-Pesa. Enter your M-Pesa number at checkout and approve the payment prompt on your phone with your PIN. We never ask for your PIN on this website.',
  q3: 'What is a pre-order?', a3: 'When a card is out of stock you can still buy it. You pay now and we send the code automatically when the card arrives. The expected date is shown before you pay.',
  q4: 'Can I send a gift card to someone else?', a4: 'Yes. At checkout choose SMS or email and enter their phone number or email address. They receive the code directly.',
  q5: 'Can I get a refund?', a5: 'No. Gift card codes are digital and can’t be returned or refunded once delivered. If a code doesn’t work, contact us and we will help.',
  q6: 'Do I need an account?', a6: 'You sign in with your phone number and a one-time SMS code. That keeps your orders and codes in one place.',
  termsP1: 'eCards sells digital gift card codes for use with the brands shown. Prices are in Ethiopian Birr and include {vat}% VAT. An order is confirmed when M-Pesa confirms your payment.',
  termsP2: 'Codes are for personal use and may not be resold. Each brand’s own terms apply when you redeem a code.',
  refundP1: 'All sales are final. Gift card codes can’t be returned, exchanged or refunded once delivered, because a delivered code can be used straight away.',
  refundP2: 'If a code doesn’t work, or a pre-order is late, contact us with your order number and we will make it right.',
  privP1: 'We keep your name, phone number, the email or number you send codes to, and your orders. We use them to deliver your codes and help you. We don’t sell your data.',
  privP2: 'Payments are handled by M-Pesa; we never see or store your M-Pesa PIN.',
  contactHours: 'Every day, {from}–{to}', replySoon: 'We reply as soon as we can', contactSoon: 'Contact details are coming soon.',
  tHome: 'Gift cards in Ethiopia, pay with M-Pesa',
  maxBuy: 'You can buy up to {n} of this card at a time', added: '{n} × {name} added to your cart', removed: '{name} removed', codeCopied: 'Code copied', copyNA: 'Copy isn’t available here · select the code to copy it',
  arrived: 'Your pre-ordered card arrived. The code is in My orders.', previewNote: 'Preview window: the store works here, but open web.html from the folder to share data with the admin.',
  signedOut: 'Signed out', welcome: 'Welcome, {name}', signedInAs: 'Signed in as {name}', newCode: 'New code sent · demo: it’s shown on screen',
  close: 'Close', siH: 'Sign in or create an account', siP: 'We’ll text a 6-digit code to your phone. Use the number you pay with on M-Pesa.', phoneL: 'Phone number', sendCode: 'Send code',
  agreeFine: 'By continuing you agree to our terms and privacy policy.', codeH: 'Enter the code', codeP: 'We sent a 6-digit code to {phone}.', demoCode: 'Demo: no SMS is sent. Your code is {code}.',
  code6: '6-digit code', changeNum: 'Change number', resendIn: 'Send again in {s}s', resendNew: 'Send a new code', cont: 'Continue',
  welcomeH: 'Welcome to eCards', welcomeP: 'One last thing: what should we call you? You can add an email to get codes there.', yourName: 'Your name', namePh: 'For example Selam Bekele', optional: '(optional)',
  errName: 'Enter your name.', errMail: 'Enter a valid email address, or leave it empty.', createAcc: 'Create account', errPhone0: 'Enter your phone number.',
  errPhone: 'Enter a valid Ethiopian mobile number, like 0912 345 678 or 0712 345 678.', err6: 'Enter the 6 digits from the SMS.', errCode: 'That code is wrong. Check the SMS and try again.', errCode3: 'That code is wrong. Send a new code and try again.',
  coH: 'Checkout', preTag: 'pre-order', totVat: 'Total, VAT included', sendBy: 'Send the codes by', sms: 'SMS', smsPhone: 'Phone number for the SMS', giftHintP: 'Your number or someone else’s, to send it as a gift.',
  emailAddr: 'Email address', giftHintE: 'Yours or someone else’s, to send it as a gift.', payNum: 'Pay with M-Pesa number', payHint: 'You’ll get a payment prompt on this phone. Never share your PIN.',
  preNoteAll: 'These cards are out of stock. You pay now and we send the codes when they arrive, expected by {date}.', preNoteSome: 'Some cards are out of stock. You pay now and we send those codes when they arrive, expected by {date}.',
  agreeChk: 'I understand gift card codes are digital and can’t be refunded once delivered.', payBtn: 'Pay {amount} with M-Pesa',
  stkH: 'Check your phone', stkP: 'We sent a payment request of {amount} to {phone}. Open the M-Pesa prompt and enter your PIN to approve it.', waitAppr: 'Waiting for approval · {t}',
  stkDemo: 'Demo: no payment request is sent. Choose what happens on the phone:', decline: 'Decline on phone', approve: 'Approve on phone', cancelPay: 'Cancel payment',
  confirming: 'Confirming', confH: 'Confirming your payment', confP: 'This takes a few seconds. Don’t close this window.', doneH: 'Payment received', orderL: 'Order {id} · {amount}',
  sendSms: 'We’re sending the codes by SMS to {to}.', sendSmsLater: 'We’ll send the codes by SMS to {to} when they arrive.', sendMail: 'We’re sending the codes to {to}.', sendMailLater: 'We’ll send the codes to {to} when they arrive.',
  demoNothing: 'Demo: nothing is sent.', keepShop: 'Keep shopping', viewOrders: 'View my orders',
  declH: 'Payment declined', expH: 'Payment request expired', cancH: 'Payment cancelled', declP: 'The payment was declined on the phone.', expP: 'The request wasn’t approved in time.', cancP: 'You cancelled the payment.',
  notCharged: 'Nothing was charged and your cart is saved.', backCart: 'Back to cart', tryAgain: 'Try again',
  errTo0Sms: 'Enter the phone number to send the codes to.', errToSms: 'Enter a valid Ethiopian mobile number for the SMS.', errTo0Mail: 'Enter the email address to send the codes to.', errToMail: 'Enter a valid email address.',
  errPay: 'Enter the M-Pesa number you’ll pay with.', errAgree: 'Please confirm you understand codes can’t be refunded.'
};
WEB_I18N.am = {
  homeAria: 'eCards መነሻ', navGift: 'የስጦታ ካርዶች', navHow: 'እንዴት ይሠራል', navHelp: 'እገዛ', mainNav: 'ዋና ምናሌ',
  searchLbl: 'የስጦታ ካርዶችን ፈልግ', searchPh: 'Netflix፣ PlayStation… ፈልግ', search: 'ፈልግ',
  myOrders: 'የእኔ ትዕዛዞች', helpContact: 'እገዛና አድራሻ', signOut: 'ውጣ', signIn: 'ግባ', cartAria: 'ጋሪ፣ {n}', language: 'ቋንቋ',
  footBlurb: 'ለኢትዮጵያ የዲጂታል የስጦታ ካርዶች፣ ዋጋቸው በብር ተ.እ.ታን ጨምሮ። በM-Pesa ይክፈሉ፤ ኮድዎን በኤስኤምኤስ ወይም በኢሜይል ያግኙ። በM-Pesa መተግበሪያ ውስጥም ይገኛል።',
  shop: 'ይግዙ', allCards: 'ሁሉም የስጦታ ካርዶች', qa: 'ጥያቄዎችና መልሶች', contactUs: 'ያግኙን', everyDay: 'በየቀኑ {from}–{to}', legal: 'ሕጋዊ',
  terms: 'የአገልግሎት ውል', privacy: 'የግላዊነት ፖሊሲ', norefund: 'ገንዘብ ያለመመለስ ፖሊሲ',
  footPrices: 'ዋጋዎች በኢትዮጵያ ብር (ETB)፣ ተ.እ.ታን ጨምሮ', footDemo: 'የሙከራ መደብር፦ እውነተኛ ክፍያ፣ ኤስኤምኤስ ወይም ኮድ የለም',
  cat_gaming: 'ጨዋታዎች', cat_apps: 'መተግበሪያዎች', cat_video: 'ፊልምና ቪዲዮ', cat_music: 'ሙዚቃ', cat_telecom: 'የሞባይል ካርድ', cat_card: 'የስጦታ ካርዶች', catAll: 'ሁሉም', category: 'ምድብ',
  preorder: 'ቅድመ ትዕዛዝ', instant: 'ወዲያውኑ', onlyLeft: '{n} ብቻ ቀርተዋል', from: 'ከ', cardAria: 'የ{name} የስጦታ ካርድ፣ ከ{price} ጀምሮ',
  eyebrow: 'ወዲያውኑ ይደርሳል · በM-Pesa ይክፈሉ', heroH: 'ለሚወዷቸው ጨዋታዎች፣ ሙዚቃዎችና ፊልሞች የስጦታ ካርዶች',
  heroP: 'Netflix፣ PlayStation፣ Spotify፣ Steam እና ሌሎችም፣ ዋጋቸው በብር ተ.እ.ታን ጨምሮ። በM-Pesa ይክፈሉ፤ ኮድዎን በሰከንዶች ውስጥ በኤስኤምኤስ ወይም በኢሜይል ያግኙ።',
  browse: 'የስጦታ ካርዶችን ይመልከቱ', pt1: 'ኮድ በሰከንዶች ውስጥ', pt2: 'ዋጋ በብር፣ ተ.እ.ታን ጨምሮ', pt3: 'በየቀኑ ድጋፍ',
  popular: 'ታዋቂ ብራንዶች', seeAll: 'ሁሉንም የስጦታ ካርዶች ይመልከቱ', shopBrand: 'የ{brand} የስጦታ ካርዶችን ይግዙ', giftCards: 'የስጦታ ካርዶች',
  howSub: 'ሦስት ደረጃዎች፣ ብዙውን ጊዜ ከአንድ ደቂቃ በታች።',
  s1h: '1. ካርድ ይምረጡ', s1p: 'ብራንዱንና መጠኑን ይምረጡ። ዋጋዎች በብር ናቸው፤ {vat}% ተ.እ.ታን ቀድመው ያካትታሉ።',
  s2h: '2. በM-Pesa ይክፈሉ', s2p: 'የM-Pesa ቁጥርዎን ያስገቡ። ክፍያውን በስልክዎ ላይ በፒንዎ ያጽድቁ።',
  s3h: '3. ኮድዎን ያግኙ', s3p: 'ኮድዎ በማያ ገጹና በ«የእኔ ትዕዛዞች» ይታያል፤ በኤስኤምኤስ ወይም በኢሜይልም እንልካለን።',
  tr1h: 'ፈጣን አቅርቦት', tr1p: 'ያሉ ካርዶች ከክፍያ በኋላ በሰከንዶች ውስጥ ይደርሳሉ።', tr2h: 'ደህንነቱ የተጠበቀ የM-Pesa ክፍያ', tr2p: 'እያንዳንዱን ክፍያ በራስዎ ስልክ ያጸድቃሉ።',
  tr3h: 'ተ.እ.ታን ጨምሮ', tr3p: 'የሚያዩት ዋጋ የሚከፍሉት ዋጋ ነው።', tr4h: 'በየቀኑ እገዛ', tr4p: '{from}–{to} በስልክ፣ በቴሌግራም ወይም በኢሜይል።', tr4p0: 'በስልክ፣ በቴሌግራም ወይም በኢሜይል።',
  noFound: 'ምንም የስጦታ ካርድ አልተገኘም', noMatch: '«{q}» የሚመስል ምንም የለም።', noMatchIn: 'በ{cat} ውስጥ «{q}» የሚመስል ምንም የለም።', tryAnother: 'ሌላ ስም ወይም ምድብ ይሞክሩ።', showAll: 'ሁሉንም የስጦታ ካርዶች አሳይ',
  allSub: '{n} ብራንዶች · ዲጂታል ኮዶች በኤስኤምኤስ ወይም በኢሜይል ይደርሳሉ', searchBrands: 'ብራንዶችን ፈልግ', sort: 'ደርድር', sortPop: 'በጣም ታዋቂ', sortPrice: 'ዝቅተኛ ዋጋ', sortAz: 'ስም ከሀ–ፐ',
  naH: 'ይህ የስጦታ ካርድ አይገኝም', naP: 'ከመደብሩ ተወግዶ ሊሆን ይችላል።', crumbHome: 'መነሻ', crumbs: 'የገጽ መንገድ',
  cardTitle: 'የ{name} የስጦታ ካርድ', pdSub: 'ዲጂታል ኮድ · በኤስኤምኤስ ወይም በኢሜይል ይደርሳል · በኢትዮጵያ ለመጠቀም', chooseVal: 'መጠን ይምረጡ', vatIncl: 'ተ.እ.ታ ተካቷል ({vat})',
  avPreB: 'አልቋል፤ በቅድመ ትዕዛዝ ይገኛል።', avPre: 'አሁን ይከፍላሉ፤ ካርዱ እንደገባ ኮድዎን እንልካለን፤ እስከ {date} ይጠበቃል።',
  avLowB: '{n} ብቻ ቀርተዋል።', avLow: 'ከክፍያ በኋላ ወዲያውኑ ይደርሳል።', avOkB: 'አለ።', avOk: 'ኮድዎ ከክፍያ በኋላ በሰከንዶች ውስጥ ይደርሳል።',
  qty: 'ብዛት', less: 'አንድ ቀንስ', more: 'አንድ ጨምር', addCart: 'ወደ ጋሪ ጨምር', buyNow: 'አሁን ይግዙ', preNow: 'አሁን ቅድመ ትዕዛዝ ይስጡ',
  n1: 'ከማንኛውም የኢትዮጵያ ሞባይል ቁጥር በM-Pesa ይክፈሉ።', n2: 'ኮዱን በኤስኤምኤስ ወይም በኢሜይል እንልካለን፤ በ«የእኔ ትዕዛዞች» ውስጥም ይቀመጣል።', n3: 'ዲጂታል ኮዶች ከደረሱ በኋላ አይመለሱም፤ ገንዘብም አይመለስም። ከመክፈልዎ በፊት መጠኑን ያረጋግጡ።',
  redeemH: 'የ{brand} ኮድዎን እንዴት እንደሚጠቀሙ', r1: '{brand}ን በስልክዎ፣ በኮንሶልዎ ወይም በኮምፒውተርዎ ይክፈቱና ወደ መለያዎ ይግቡ።',
  r2: 'የስጦታ ካርድ ወይም ኮድ ማስገቢያውን ይፈልጉ (ብዙ ጊዜ Redeem፣ Add funds ወይም Gift card ይባላል)።', r3: 'ኮዱን እንደሚታየው በትክክል ይጻፉ። ገንዘቡ ወዲያውኑ ወደ ሂሳብዎ ይጨመራል።',
  alsoLike: 'እነዚህንም ሊወዱ ይችላሉ',
  cartH: 'የእርስዎ ጋሪ', cartEmptyH: 'ጋሪዎ ባዶ ነው', cartEmptyP: 'የስጦታ ካርድ ሲጨምሩ እዚህ ይታያል።', cards1: '1 ካርድ', cardsN: '{n} ካርዶች',
  each: 'እያንዳንዱ {price} · ተ.እ.ታን ጨምሮ', qtyOf: 'የ{name} ብዛት', remove: 'አስወግድ', preExp: 'ቅድመ ትዕዛዝ · እስከ {date} ይጠበቃል',
  summary: 'ማጠቃለያ', subtotal: 'ንዑስ ድምር', vatPctL: 'ተ.እ.ታ ተካቷል ({vat}%)', delivery: 'ማድረሻ', deliveryFree: 'ነፃ · ኤስኤምኤስ ወይም ኢሜይል', total: 'ጠቅላላ',
  checkout: 'ወደ ክፍያ', signToCheck: 'ለመክፈል ይግቡ', payWith: 'ክፍያ በ', preFine: 'የቅድመ ትዕዛዝ ካርዶች አሁን ይከፈላሉ፤ ሲገቡ ይላካሉ።', noRefundFine: 'ዲጂታል ኮዶች ከደረሱ በኋላ ገንዘብ አይመለስም።',
  showCode: 'ኮዱን አሳይ', hideCode: 'ኮዱን ደብቅ', copyCode: 'ኮዱን ቅዳ',
  signSeeH: 'ትዕዛዞችዎን ለማየት ይግቡ', signSeeP: 'የከፈሉበትን ስልክ ቁጥር ይጠቀሙ። ኮዶችዎ እዚያ ተቀምጠዋል።', noOrdersH: 'እስካሁን ትዕዛዝ የለም', noOrdersP: 'የሚገዟቸው የስጦታ ካርዶች ከኮዶቻቸው ጋር እዚህ ይታያሉ።',
  signedAs: 'እንደ {name} ገብተዋል · {phone}', stDelivered: 'ደርሷል', stPartly: 'በከፊል ደርሷል', stWaiting: 'ካርድ በመጠበቅ ላይ', mpesaApp: 'M-Pesa መተግበሪያ',
  expBy: 'እስከ {date} ይጠበቃል', paidWait: 'ተከፍሏል። ካርዱ እንደገባ ኮዱን እንልካለን።', paidMpesa: 'በM-Pesa ተከፍሏል', sentSms: 'ኮዶች በኤስኤምኤስ ወደ {to} ተልከዋል', sentMail: 'ኮዶች ወደ {to} ተልከዋል', cardOf: 'የ{v} ካርድ',
  helpSub: 'ለተለመዱ ጥያቄዎች መልሶች፣ እኛን የማግኛ መንገዶችና ፖሊሲዎቻችን።', call: 'ይደውሉልን', emailL: 'ኢሜይል',
  q1: 'ኮዴን በምን ያህል ፍጥነት አገኛለሁ?', a1: 'ያሉ ካርዶች የM-Pesa ክፍያውን ካጸደቁ በኋላ በሰከንዶች ውስጥ ይደርሳሉ። ኮዱ በማያ ገጹ፣ በ«የእኔ ትዕዛዞች» እና በኤስኤምኤስ ወይም በኢሜይል ይደርስዎታል።',
  q2: 'እንዴት እከፍላለሁ?', a2: 'በM-Pesa። በክፍያ ጊዜ የM-Pesa ቁጥርዎን ያስገቡና በስልክዎ የሚመጣውን የክፍያ ጥያቄ በፒንዎ ያጽድቁ። በዚህ ድረ ገጽ ላይ ፒንዎን በፍጹም አንጠይቅም።',
  q3: 'ቅድመ ትዕዛዝ ምንድን ነው?', a3: 'ካርድ ቢያልቅም መግዛት ይችላሉ። አሁን ይከፍላሉ፤ ካርዱ ሲገባ ኮዱን በራስ ሰር እንልካለን። የሚጠበቀው ቀን ከመክፈልዎ በፊት ይታያል።',
  q4: 'የስጦታ ካርድ ለሌላ ሰው መላክ እችላለሁ?', a4: 'አዎ። በክፍያ ጊዜ ኤስኤምኤስ ወይም ኢሜይል ይምረጡና የሰውየውን ስልክ ቁጥር ወይም ኢሜይል ያስገቡ። ኮዱ በቀጥታ ይደርሳቸዋል።',
  q5: 'ገንዘቤ ሊመለስልኝ ይችላል?', a5: 'አይ። የስጦታ ካርድ ኮዶች ዲጂታል ናቸው፤ ከደረሱ በኋላ አይመለሱም፤ ገንዘብም አይመለስም። ኮድ ካልሠራ ያግኙን፤ እንረዳዎታለን።',
  q6: 'መለያ ያስፈልገኛል?', a6: 'በስልክ ቁጥርዎና በአንድ ጊዜ የኤስኤምኤስ ኮድ ይገባሉ። ይህ ትዕዛዞችዎንና ኮዶችዎን በአንድ ቦታ ያስቀምጣል።',
  termsP1: 'eCards ለሚታዩት ብራንዶች የሚያገለግሉ ዲጂታል የስጦታ ካርድ ኮዶችን ይሸጣል። ዋጋዎች በኢትዮጵያ ብር ሲሆኑ {vat}% ተ.እ.ታን ያካትታሉ። ትዕዛዝ የሚረጋገጠው M-Pesa ክፍያዎን ሲያረጋግጥ ነው።',
  termsP2: 'ኮዶች ለግል ጥቅም ብቻ ናቸው፤ እንደገና ሊሸጡ አይችሉም። ኮድ ሲጠቀሙ የእያንዳንዱ ብራንድ ውል ተፈጻሚ ይሆናል።',
  refundP1: 'ሁሉም ሽያጮች የመጨረሻ ናቸው። የደረሰ ኮድ ወዲያውኑ ጥቅም ላይ ሊውል ስለሚችል የስጦታ ካርድ ኮዶች ከደረሱ በኋላ አይመለሱም፣ አይቀየሩም፣ ገንዘብም አይመለስም።',
  refundP2: 'ኮድ ካልሠራ ወይም ቅድመ ትዕዛዝ ከዘገየ በትዕዛዝ ቁጥርዎ ያግኙን፤ ችግሩን እንፈታለን።',
  privP1: 'ስምዎን፣ ስልክ ቁጥርዎን፣ ኮዶች የሚላኩበትን ኢሜይል ወይም ቁጥር እና ትዕዛዞችዎን እንይዛለን። ኮዶችዎን ለማድረስና እርስዎን ለመርዳት እንጠቀምባቸዋለን። መረጃዎን አንሸጥም።',
  privP2: 'ክፍያዎች በM-Pesa ይስተናገዳሉ፤ የM-Pesa ፒንዎን በፍጹም አናይም አናስቀምጥምም።',
  contactHours: 'በየቀኑ፣ {from}–{to}', replySoon: 'በተቻለ ፍጥነት እንመልሳለን', contactSoon: 'የመገኛ አድራሻዎች በቅርቡ ይቀርባሉ።',
  tHome: 'በኢትዮጵያ የስጦታ ካርዶች፣ በM-Pesa ይክፈሉ',
  maxBuy: 'ከዚህ ካርድ በአንድ ጊዜ እስከ {n} መግዛት ይችላሉ', added: '{n} × {name} ወደ ጋሪዎ ተጨምሯል', removed: '{name} ተወግዷል', codeCopied: 'ኮዱ ተቀድቷል', copyNA: 'እዚህ መቅዳት አይቻልም · ኮዱን መርጠው ይቅዱ',
  arrived: 'በቅድመ ትዕዛዝ ያዘዙት ካርድ ደርሷል። ኮዱ በ«የእኔ ትዕዛዞች» ውስጥ ነው።', previewNote: 'የቅድመ እይታ መስኮት፦ መደብሩ እዚህ ይሠራል፤ ከአስተዳዳሪው ጋር መረጃ ለመጋራት ግን web.htmlን ከአቃፊው ይክፈቱ።',
  signedOut: 'ወጥተዋል', welcome: 'እንኳን ደህና መጡ፣ {name}', signedInAs: 'እንደ {name} ገብተዋል', newCode: 'አዲስ ኮድ ተልኳል · ሙከራ፦ በማያ ገጹ ይታያል',
  close: 'ዝጋ', siH: 'ይግቡ ወይም መለያ ይፍጠሩ', siP: 'ባለ 6 አሃዝ ኮድ ወደ ስልክዎ እንልካለን። በM-Pesa የሚከፍሉበትን ቁጥር ይጠቀሙ።', phoneL: 'ስልክ ቁጥር', sendCode: 'ኮድ ላክ',
  agreeFine: 'በመቀጠል በውላችንና በግላዊነት ፖሊሲያችን ይስማማሉ።', codeH: 'ኮዱን ያስገቡ', codeP: 'ባለ 6 አሃዝ ኮድ ወደ {phone} ልከናል።', demoCode: 'ሙከራ፦ ምንም ኤስኤምኤስ አይላክም። ኮድዎ {code} ነው።',
  code6: 'ባለ 6 አሃዝ ኮድ', changeNum: 'ቁጥር ቀይር', resendIn: 'በ{s} ሰከንድ እንደገና ላክ', resendNew: 'አዲስ ኮድ ላክ', cont: 'ቀጥል',
  welcomeH: 'ወደ eCards እንኳን ደህና መጡ', welcomeP: 'አንድ የመጨረሻ ነገር፦ በምን ስም እንጥራዎት? ኮዶችን በኢሜይል ለማግኘት ኢሜይል ማከል ይችላሉ።', yourName: 'ስምዎ', namePh: 'ለምሳሌ ሰላም በቀለ', optional: '(አማራጭ)',
  errName: 'ስምዎን ያስገቡ።', errMail: 'ትክክለኛ ኢሜይል ያስገቡ ወይም ባዶ ይተዉት።', createAcc: 'መለያ ፍጠር', errPhone0: 'ስልክ ቁጥርዎን ያስገቡ።',
  errPhone: 'ትክክለኛ የኢትዮጵያ ሞባይል ቁጥር ያስገቡ፤ ለምሳሌ 0912 345 678 ወይም 0712 345 678።', err6: 'ከኤስኤምኤሱ 6ቱን አሃዞች ያስገቡ።', errCode: 'ኮዱ ትክክል አይደለም። ኤስኤምኤሱን አይተው እንደገና ይሞክሩ።', errCode3: 'ኮዱ ትክክል አይደለም። አዲስ ኮድ አስልከው እንደገና ይሞክሩ።',
  coH: 'ክፍያ', preTag: 'ቅድመ ትዕዛዝ', totVat: 'ጠቅላላ፣ ተ.እ.ታን ጨምሮ', sendBy: 'ኮዶቹ የሚላኩት በ', sms: 'ኤስኤምኤስ', smsPhone: 'ኤስኤምኤስ የሚላክበት ስልክ ቁጥር', giftHintP: 'የራስዎ ወይም የሌላ ሰው ቁጥር፣ በስጦታ ለመላክ።',
  emailAddr: 'የኢሜይል አድራሻ', giftHintE: 'የራስዎ ወይም የሌላ ሰው፣ በስጦታ ለመላክ።', payNum: 'የሚከፍሉበት የM-Pesa ቁጥር', payHint: 'በዚህ ስልክ የክፍያ ጥያቄ ይደርስዎታል። ፒንዎን ለማንም አያጋሩ።',
  preNoteAll: 'እነዚህ ካርዶች አልቀዋል። አሁን ይከፍላሉ፤ ሲገቡ ኮዶቹን እንልካለን፤ እስከ {date} ይጠበቃሉ።', preNoteSome: 'አንዳንድ ካርዶች አልቀዋል። አሁን ይከፍላሉ፤ ሲገቡ የእነዚያን ኮዶች እንልካለን፤ እስከ {date} ይጠበቃሉ።',
  agreeChk: 'የስጦታ ካርድ ኮዶች ዲጂታል መሆናቸውንና ከደረሱ በኋላ ገንዘብ እንደማይመለስ ተረድቻለሁ።', payBtn: '{amount} በM-Pesa ይክፈሉ',
  stkH: 'ስልክዎን ይመልከቱ', stkP: 'የ{amount} የክፍያ ጥያቄ ወደ {phone} ልከናል። የM-Pesa መልዕክቱን ከፍተው ለማጽደቅ ፒንዎን ያስገቡ።', waitAppr: 'ማጽደቅን በመጠበቅ ላይ · {t}',
  stkDemo: 'ሙከራ፦ ምንም የክፍያ ጥያቄ አይላክም። በስልኩ ላይ የሚሆነውን ይምረጡ፦', decline: 'በስልክ ውድቅ አድርግ', approve: 'በስልክ አጽድቅ', cancelPay: 'ክፍያውን ሰርዝ',
  confirming: 'በማረጋገጥ ላይ', confH: 'ክፍያዎን በማረጋገጥ ላይ', confP: 'ጥቂት ሰከንዶች ይወስዳል። ይህን መስኮት አይዝጉ።', doneH: 'ክፍያው ደርሷል', orderL: 'ትዕዛዝ {id} · {amount}',
  sendSms: 'ኮዶቹን በኤስኤምኤስ ወደ {to} እየላክን ነው።', sendSmsLater: 'ኮዶቹ ሲገቡ በኤስኤምኤስ ወደ {to} እንልካለን።', sendMail: 'ኮዶቹን ወደ {to} እየላክን ነው።', sendMailLater: 'ኮዶቹ ሲገቡ ወደ {to} እንልካለን።',
  demoNothing: 'ሙከራ፦ ምንም አይላክም።', keepShop: 'ግዢውን ቀጥሉ', viewOrders: 'ትዕዛዞቼን ይመልከቱ',
  declH: 'ክፍያው ውድቅ ሆኗል', expH: 'የክፍያ ጥያቄው ጊዜው አልፏል', cancH: 'ክፍያው ተሰርዟል', declP: 'ክፍያው በስልኩ ላይ ውድቅ ተደርጓል።', expP: 'ጥያቄው በጊዜው አልጸደቀም።', cancP: 'ክፍያውን ሰርዘዋል።',
  notCharged: 'ምንም ገንዘብ አልተቆረጠም፤ ጋሪዎ ተቀምጧል።', backCart: 'ወደ ጋሪ ተመለስ', tryAgain: 'እንደገና ሞክር',
  errTo0Sms: 'ኮዶቹ የሚላኩበትን ስልክ ቁጥር ያስገቡ።', errToSms: 'ለኤስኤምኤሱ ትክክለኛ የኢትዮጵያ ሞባይል ቁጥር ያስገቡ።', errTo0Mail: 'ኮዶቹ የሚላኩበትን ኢሜይል ያስገቡ።', errToMail: 'ትክክለኛ ኢሜይል ያስገቡ።',
  errPay: 'የሚከፍሉበትን የM-Pesa ቁጥር ያስገቡ።', errAgree: 'ኮዶች ገንዘብ እንደማይመለስባቸው መረዳትዎን ያረጋግጡ።'
};
WEB_I18N.om = {
  homeAria: 'Fuula jalqabaa eCards', navGift: 'Kaardiiwwan kennaa', navHow: 'Akkamitti hojjeta', navHelp: 'Gargaarsa', mainNav: 'Baafata ijoo',
  searchLbl: 'Kaardiiwwan kennaa barbaadi', searchPh: 'Netflix, PlayStation… barbaadi', search: 'Barbaadi',
  myOrders: 'Ajajawwan koo', helpContact: 'Gargaarsaa fi quunnamtii', signOut: 'Ba’i', signIn: 'Seeni', cartAria: 'Qodaa bittaa, {n}', language: 'Afaan',
  footBlurb: 'Kaardiiwwan kennaa dijitaalaa Itoophiyaaf, gatiin isaanii Birriin VAT dabalatee. M-Pesa’n kaffaliitii koodii kee SMS ykn imeeliidhaan argadhu. Appii M-Pesa keessattis ni argama.',
  shop: 'Bitadhu', allCards: 'Kaardiiwwan kennaa hunda', qa: 'Gaaffiiwwanii fi deebiiwwan', contactUs: 'Nu quunnamaa', everyDay: 'Guyyaa guyyaan {from}–{to}', legal: 'Seeraa',
  terms: 'Haala tajaajilaa', privacy: 'Imaammata dhuunfaa', norefund: 'Imaammata maallaqni hin deebine',
  footPrices: 'Gatiin Birr Itoophiyaatiin (ETB), VAT dabalatee', footDemo: 'Suuqii yaalii: kaffaltiin, SMS ykn koodiin dhugaa hin jiru',
  cat_gaming: 'Taphoota', cat_apps: 'Appiiwwan', cat_video: 'Fiilmii fi viidiyoo', cat_music: 'Muuziqaa', cat_telecom: 'Kaardii bilbilaa', cat_card: 'Kaardiiwwan kennaa', catAll: 'Hunda', category: 'Ramaddii',
  preorder: 'Dursa ajaja', instant: 'Battaluma', onlyLeft: '{n} qofatu hafe', from: 'Irraa', cardAria: 'Kaardii kennaa {name}, {price} irraa',
  eyebrow: 'Battaluma ga’a · M-Pesa’n kaffali', heroH: 'Kaardiiwwan kennaa taphoota, muuziqaa fi fiilmiiwwan jaallattuuf',
  heroP: 'Netflix, PlayStation, Spotify, Steam fi kan biroo, gatiin Birriin VAT dabalatee. M-Pesa’n kaffaliitii koodii kee sekondii keessatti SMS ykn imeeliidhaan argadhu.',
  browse: 'Kaardiiwwan kennaa ilaali', pt1: 'Koodii sekondii keessatti', pt2: 'Gatiin Birriin, VAT dabalatee', pt3: 'Deeggarsa guyyaa guyyaan',
  popular: 'Biraandota beekamoo', seeAll: 'Kaardiiwwan kennaa hunda ilaali', shopBrand: 'Kaardiiwwan kennaa {brand} bitadhu', giftCards: 'Kaardiiwwan kennaa',
  howSub: 'Tarkaanfii sadii, yeroo baay’ee daqiiqaa tokkoo gadi.',
  s1h: '1. Kaardii filadhu', s1p: 'Biraandii fi gatii filadhu. Gatiin Birriin yoo ta’u VAT {vat}% dursee of keessaa qaba.',
  s2h: '2. M-Pesa’n kaffali', s2p: 'Lakkoofsa M-Pesa kee galchi. Kaffaltii bilbila kee irratti PIN keetiin mirkaneessi.',
  s3h: '3. Koodii kee argadhu', s3p: 'Koodiin kee iskiriinii irratti fi “Ajajawwan koo” keessatti mul’ata; SMS ykn imeeliidhaanis siif ergina.',
  tr1h: 'Battaluma ga’a', tr1p: 'Kaardiiwwan jiran kaffaltii booda sekondii keessatti ga’u.', tr2h: 'Kaffaltii M-Pesa amansiisaa', tr2p: 'Kaffaltii hunda bilbila kee irratti ofumaan mirkaneessita.',
  tr3h: 'VAT dabalatee', tr3p: 'Gatiin argitu gatii kaffaltuudha.', tr4h: 'Gargaarsa guyyaa guyyaan', tr4p: '{from}–{to} bilbilaan, Telegram ykn imeeliidhaan.', tr4p0: 'Bilbilaan, Telegram ykn imeeliidhaan.',
  noFound: 'Kaardiin kennaa hin argamne', noMatch: '“{q}” wajjin kan walsimu hin jiru.', noMatchIn: '{cat} keessatti “{q}” wajjin kan walsimu hin jiru.', tryAnother: 'Maqaa ykn ramaddii biraa yaali.', showAll: 'Kaardiiwwan kennaa hunda agarsiisi',
  allSub: 'Biraandota {n} · koodiiwwan dijitaalaa SMS ykn imeeliidhaan ga’u', searchBrands: 'Biraandota barbaadi', sort: 'Tartiibi', sortPop: 'Kan baay’ee beekame', sortPrice: 'Gatii gadi aanaa', sortAz: 'Maqaa A–Z',
  naH: 'Kaardiin kennaa kun hin argamu', naP: 'Suuqii irraa haqamee ta’uu danda’a.', crumbHome: 'Jalqaba', crumbs: 'Karaa fuulaa',
  cardTitle: 'Kaardii kennaa {name}', pdSub: 'Koodii dijitaalaa · SMS ykn imeeliidhaan ga’a · Itoophiyaa keessatti fayyadamuuf', chooseVal: 'Gatii filadhu', vatIncl: 'VAT dabalatee ({vat})',
  avPreB: 'Dhumeera; dursa ajajaan ni argama.', avPre: 'Amma kaffalta; akkuma kaardichi gale koodii kee siif ergina, {date} dura ni eegama.',
  avLowB: '{n} qofatu hafe.', avLow: 'Kaffaltii booda battaluma ga’a.', avOkB: 'Ni jira.', avOk: 'Koodiin kee kaffaltii booda sekondii keessatti ga’a.',
  qty: 'Baay’ina', less: 'Tokko hir’isi', more: 'Tokko dabali', addCart: 'Qodaa bittaatti dabali', buyNow: 'Amma bitadhu', preNow: 'Amma dursii ajaji',
  n1: 'Lakkoofsa moobaayilaa Itoophiyaa kamiin iyyuu M-Pesa’n kaffali.', n2: 'Koodicha SMS ykn imeeliidhaan ergina; “Ajajawwan koo” keessattis ni turra.', n3: 'Koodiiwwan dijitaalaa erga ga’anii booda hin deebi’an, maallaqnis hin deebi’u. Utuu hin kaffalin gatii mirkaneeffadhu.',
  redeemH: 'Koodii {brand} kee akkamitti itti fayyadamta', r1: '{brand} bilbila, konsoolii ykn kompiitara kee irratti bani; herrega keetti seeni.',
  r2: 'Bakka kaardii kennaa ykn koodii galchuu barbaadi (yeroo baay’ee Redeem, Add funds ykn Gift card jedhama).', r3: 'Koodicha akkuma mul’atutti sirriitti barreessi. Gatiin isaa battaluma herrega keetti ida’ama.',
  alsoLike: 'Kanneenis si gammachiisuu danda’u',
  cartH: 'Qodaa bittaa kee', cartEmptyH: 'Qodaan bittaa kee duwwaadha', cartEmptyP: 'Yeroo kaardii kennaa dabaltu asitti mul’ata.', cards1: 'Kaardii 1', cardsN: 'Kaardiiwwan {n}',
  each: 'Tokkoon tokkoon {price} · VAT dabalatee', qtyOf: 'Baay’ina {name}', remove: 'Haqi', preExp: 'Dursa ajaja · {date} dura ni eegama',
  summary: 'Cuunfaa', subtotal: 'Ida’ama xiqqaa', vatPctL: 'VAT dabalatee ({vat}%)', delivery: 'Erguu', deliveryFree: 'Bilisa · SMS ykn imeelii', total: 'Waliigala',
  checkout: 'Gara kaffaltii', signToCheck: 'Kaffaluuf seeni', payWith: 'Kan itti kaffaltu', preFine: 'Kaardiiwwan dursa ajajaa amma kaffalamu, yeroo galan ergamu.', noRefundFine: 'Koodiiwwan dijitaalaa erga ga’anii booda maallaqni hin deebi’u.',
  showCode: 'Koodii agarsiisi', hideCode: 'Koodii dhoksi', copyCode: 'Koodii garagalchi',
  signSeeH: 'Ajajawwan kee ilaaluuf seeni', signSeeP: 'Lakkoofsa bilbilaa ittiin kaffalte fayyadami. Koodiiwwan kee achitti kuufamaniiru.', noOrdersH: 'Ammaaf ajajni hin jiru', noOrdersP: 'Kaardiiwwan kennaa bittu koodiiwwan isaanii wajjin asitti mul’atu.',
  signedAs: 'Akka {name} tti seenteetta · {phone}', stDelivered: 'Ga’eera', stPartly: 'Gartokkeen ga’eera', stWaiting: 'Kaardii eegaa jira', mpesaApp: 'Appii M-Pesa',
  expBy: '{date} dura ni eegama', paidWait: 'Kaffalameera. Akkuma kaardichi gale koodicha ergina.', paidMpesa: 'M-Pesa’n kaffalame', sentSms: 'Koodiiwwan SMS’n {to}tti ergamaniiru', sentMail: 'Koodiiwwan {to}tti ergamaniiru', cardOf: 'Kaardii {v}',
  helpSub: 'Deebii gaaffiiwwan baratamoo, karaa nu quunnamtanii fi imaammata keenya.', call: 'Nu bilbilaa', emailL: 'Imeelii',
  q1: 'Koodii koo hammam saffisaan argadha?', a1: 'Kaardiiwwan jiran kaffaltii M-Pesa erga mirkaneessitee booda sekondii keessatti ga’u. Koodiin iskiriinii irratti, “Ajajawwan koo” keessatti fi SMS ykn imeeliidhaan si ga’a.',
  q2: 'Akkamittan kaffala?', a2: 'M-Pesa’n. Yeroo kaffaltii lakkoofsa M-Pesa kee galchiitii gaaffii kaffaltii bilbila kee irratti dhufu PIN keetiin mirkaneessi. Marsariitii kana irratti PIN kee gonkumaa hin gaafannu.',
  q3: 'Dursa ajajni maali?', a3: 'Kaardiin yoo dhumes bituu dandeessa. Amma kaffalta; yeroo kaardichi gale koodicha ofumaan ergina. Guyyaan eegamu utuu hin kaffalin si agarsiifama.',
  q4: 'Kaardii kennaa nama biraatiif erguu nan danda’aa?', a4: 'Eeyyee. Yeroo kaffaltii SMS ykn imeelii filadhuutii lakkoofsa bilbilaa ykn imeelii isaanii galchi. Koodiin kallattiin isaan ga’a.',
  q5: 'Maallaqni koo naa deebi’uu danda’aa?', a5: 'Lakki. Koodiiwwan kaardii kennaa dijitaalaa waan ta’aniif erga ga’anii booda hin deebi’an, maallaqnis hin deebi’u. Koodiin yoo hin hojjenne nu quunnami; ni gargaarra.',
  q6: 'Herregni na barbaachisaa?', a6: 'Lakkoofsa bilbila keetii fi koodii SMS yeroo tokkoon seenta. Kun ajajawwanii fi koodiiwwan kee bakka tokkotti qabata.',
  termsP1: 'eCards koodiiwwan kaardii kennaa dijitaalaa biraandota mul’ataniif oolan gurgura. Gatiin Birr Itoophiyaatiin yoo ta’u VAT {vat}% of keessaa qaba. Ajajni kan mirkanaa’u yeroo M-Pesa kaffaltii kee mirkaneessu dha.',
  termsP2: 'Koodiiwwan itti fayyadama dhuunfaaf qofa; irra deebiin gurguramuu hin danda’an. Yeroo koodii fayyadamtu haalli biraandii tokkoon tokkoon isaa ni hojiirra oola.',
  refundP1: 'Gurgurtaan hundi xumuraa dha. Koodiin ga’e battaluma itti fayyadamamuu waan danda’uuf, koodiiwwan kaardii kennaa erga ga’anii booda hin deebi’an, hin jijjiiraman, maallaqnis hin deebi’u.',
  refundP2: 'Koodiin yoo hin hojjenne ykn dursa ajajni yoo turee, lakkoofsa ajaja keetiin nu quunnami; rakkoo sana ni furra.',
  privP1: 'Maqaa kee, lakkoofsa bilbilaa kee, imeelii ykn lakkoofsa koodiiwwan itti ergitu fi ajajawwan kee ni qabanna. Koodiiwwan kee ga’uu fi si gargaaruuf itti fayyadamna. Odeeffannoo kee hin gurgurru.',
  privP2: 'Kaffaltiin M-Pesa’n raawwatama; PIN M-Pesa kee gonkumaa hin argnu, hin kuusnus.',
  contactHours: 'Guyyaa guyyaan, {from}–{to}', replySoon: 'Hamma dandeenyu dafnee deebisna', contactSoon: 'Odeeffannoon quunnamtii dhiyootti dhufa.',
  tHome: 'Kaardiiwwan kennaa Itoophiyaa keessatti, M-Pesa’n kaffali',
  maxBuy: 'Kaardii kana yeroo tokkotti hanga {n} bituu dandeessa', added: '{n} × {name} qodaa bittaa keetti dabalameera', removed: '{name} haqameera', codeCopied: 'Koodiin garagalfameera', copyNA: 'Asitti garagalchuun hin danda’amu · koodicha filadhuutii garagalchi',
  arrived: 'Kaardiin ati dursitee ajajje ga’eera. Koodiin “Ajajawwan koo” keessa jira.', previewNote: 'Foddaa duraan-ilaalchaa: suuqiin asitti ni hojjeta, garuu bulchaa wajjin odeeffannoo qooddachuuf web.html galmee keessaa bani.',
  signedOut: 'Baateetta', welcome: 'Baga nagaan dhufte, {name}', signedInAs: 'Akka {name} tti seenteetta', newCode: 'Koodiin haaraan ergameera · yaalii: iskiriinii irratti mul’ata',
  close: 'Cufi', siH: 'Seeni ykn herrega uumi', siP: 'Koodii lakkoofsa 6 qabu bilbila keetti ergina. Lakkoofsa M-Pesa’n ittiin kaffaltu fayyadami.', phoneL: 'Lakkoofsa bilbilaa', sendCode: 'Koodii ergi',
  agreeFine: 'Itti fufuun haala tajaajilaa fi imaammata dhuunfaa keenyaaf walii galta.', codeH: 'Koodicha galchi', codeP: 'Koodii lakkoofsa 6 qabu {phone}tti ergineerra.', demoCode: 'Yaalii: SMS’n hin ergamu. Koodiin kee {code} dha.',
  code6: 'Koodii lakkoofsa 6', changeNum: 'Lakkoofsa jijjiiri', resendIn: 'Sekondii {s} booda irra deebi’ii ergi', resendNew: 'Koodii haaraa ergi', cont: 'Itti fufi',
  welcomeH: 'Gara eCards baga nagaan dhufte', welcomeP: 'Wanti dhumaa tokko: maqaa kamiin si haa waamnu? Koodiiwwan imeeliidhaan argachuuf imeelii dabaluu dandeessa.', yourName: 'Maqaa kee', namePh: 'Fkn Caaltuu Bayyanaa', optional: '(dirqama miti)',
  errName: 'Maqaa kee galchi.', errMail: 'Imeelii sirrii galchi ykn duwwaa dhiisi.', createAcc: 'Herrega uumi', errPhone0: 'Lakkoofsa bilbila kee galchi.',
  errPhone: 'Lakkoofsa moobaayilaa Itoophiyaa sirrii galchi, fkn 0912 345 678 ykn 0712 345 678.', err6: 'Lakkoofsota 6 SMS irraa galchi.', errCode: 'Koodiin sun dogoggora. SMS ilaaliitii irra deebi’ii yaali.', errCode3: 'Koodiin sun dogoggora. Koodii haaraa ergsiisiitii irra deebi’ii yaali.',
  coH: 'Kaffaltii', preTag: 'dursa ajaja', totVat: 'Waliigala, VAT dabalatee', sendBy: 'Koodiiwwan kan ergaman', sms: 'SMS', smsPhone: 'Lakkoofsa bilbilaa SMS itti ergamu', giftHintP: 'Kan kee ykn kan nama biraa, kennaadhaaf erguuf.',
  emailAddr: 'Teessoo imeelii', giftHintE: 'Kan kee ykn kan nama biraa, kennaadhaaf erguuf.', payNum: 'Lakkoofsa M-Pesa ittiin kaffaltu', payHint: 'Bilbila kana irratti gaaffiin kaffaltii si ga’a. PIN kee nama tokkoofuu hin qoodin.',
  preNoteAll: 'Kaardiiwwan kun dhumaniiru. Amma kaffalta; yeroo galan koodiiwwan ergina, {date} dura ni eegamu.', preNoteSome: 'Kaardiiwwan tokko tokko dhumaniiru. Amma kaffalta; yeroo galan koodiiwwan isaanii ergina, {date} dura ni eegamu.',
  agreeChk: 'Koodiiwwan kaardii kennaa dijitaalaa ta’uu isaanii fi erga ga’anii booda maallaqni akka hin deebine hubadheera.', payBtn: '{amount} M-Pesa’n kaffali',
  stkH: 'Bilbila kee ilaali', stkP: 'Gaaffii kaffaltii {amount} {phone}tti ergineerra. Ergaa M-Pesa baniitii mirkaneessuuf PIN kee galchi.', waitAppr: 'Mirkaneessa eegaa jira · {t}',
  stkDemo: 'Yaalii: gaaffiin kaffaltii hin ergamu. Waan bilbila irratti ta’u filadhu:', decline: 'Bilbila irratti didi', approve: 'Bilbila irratti mirkaneessi', cancelPay: 'Kaffaltii haqi',
  confirming: 'Mirkaneessaa jira', confH: 'Kaffaltii kee mirkaneessaa jirra', confP: 'Sekondii muraasa fudhata. Foddaa kana hin cufin.', doneH: 'Kaffaltiin nu ga’eera', orderL: 'Ajaja {id} · {amount}',
  sendSms: 'Koodiiwwan SMS’n {to}tti ergaa jirra.', sendSmsLater: 'Yeroo koodiiwwan galan SMS’n {to}tti ergina.', sendMail: 'Koodiiwwan {to}tti ergaa jirra.', sendMailLater: 'Yeroo koodiiwwan galan {to}tti ergina.',
  demoNothing: 'Yaalii: homtuu hin ergamu.', keepShop: 'Bittaa itti fufi', viewOrders: 'Ajajawwan koo ilaali',
  declH: 'Kaffaltiin didameera', expH: 'Gaaffiin kaffaltii yeroon isaa darbeera', cancH: 'Kaffaltiin haqameera', declP: 'Kaffaltiin bilbila irratti didameera.', expP: 'Gaaffichi yeroo isaatti hin mirkanoofne.', cancP: 'Kaffaltii haqxeetta.',
  notCharged: 'Maallaqni tokkollee hin muramne; qodaan bittaa kee kuufameera.', backCart: 'Gara qodaa bittaa deebi’i', tryAgain: 'Irra deebi’ii yaali',
  errTo0Sms: 'Lakkoofsa bilbilaa koodiiwwan itti ergaman galchi.', errToSms: 'SMS’f lakkoofsa moobaayilaa Itoophiyaa sirrii galchi.', errTo0Mail: 'Imeelii koodiiwwan itti ergaman galchi.', errToMail: 'Imeelii sirrii galchi.',
  errPay: 'Lakkoofsa M-Pesa ittiin kaffaltu galchi.', errAgree: 'Koodiiwwan maallaqni akka hin deebine hubachuu kee mirkaneessi.'
};
WEB_I18N.so = {
  homeAria: 'Bogga hore ee eCards', navGift: 'Kaararka hadiyadda', navHow: 'Sida ay u shaqeyso', navHelp: 'Caawimaad', mainNav: 'Liiska ugu weyn',
  searchLbl: 'Raadi kaararka hadiyadda', searchPh: 'Raadi Netflix, PlayStation…', search: 'Raadi',
  myOrders: 'Dalabaadkayga', helpContact: 'Caawimaad iyo xiriir', signOut: 'Ka bax', signIn: 'Gal', cartAria: 'Dambiil, {n}', language: 'Luqadda',
  footBlurb: 'Kaararka hadiyadda dhijitaalka ah ee Itoobiya, qiimahoodu waa Birr oo VAT ku jiro. Ku bixi M-Pesa oo koodkaaga ku hel SMS ama iimayl. Sidoo kale waxaa laga helaa abka M-Pesa.',
  shop: 'Iibso', allCards: 'Dhammaan kaararka hadiyadda', qa: 'Su’aalo iyo jawaabo', contactUs: 'Nala soo xiriir', everyDay: 'Maalin kasta {from}–{to}', legal: 'Sharci',
  terms: 'Shuruudaha adeegga', privacy: 'Siyaasadda asturnaanta', norefund: 'Siyaasadda lacag-celin la’aanta',
  footPrices: 'Qiimuhu waa Birr Itoobiyaan (ETB), VAT ku jiro', footDemo: 'Dukaan tijaabo ah: lacag bixin, SMS ama kood dhab ah ma jiro',
  cat_gaming: 'Ciyaaro', cat_apps: 'Abab', cat_video: 'Filim iyo fiidiyow', cat_music: 'Muusig', cat_telecom: 'Kaarka hadalka', cat_card: 'Kaararka hadiyadda', catAll: 'Dhammaan', category: 'Qaybta',
  preorder: 'Dalab hore', instant: 'Isla markiiba', onlyLeft: '{n} kaliya ayaa haray', from: 'Laga bilaabo', cardAria: 'Kaarka hadiyadda {name}, laga bilaabo {price}',
  eyebrow: 'Gaarsiin degdeg ah · ku bixi M-Pesa', heroH: 'Kaararka hadiyadda ee ciyaaraha, muusigga iyo bandhigyada aad jeceshahay',
  heroP: 'Netflix, PlayStation, Spotify, Steam iyo kuwo kale, qiimahoodu waa Birr oo VAT ku jiro. Ku bixi M-Pesa oo koodkaaga ku hel SMS ama iimayl ilbiriqsiyo gudahood.',
  browse: 'Eeg kaararka hadiyadda', pt1: 'Kood ilbiriqsiyo gudahood', pt2: 'Qiimaha Birr, VAT ku jiro', pt3: 'Taageero maalin kasta',
  popular: 'Summadaha caanka ah', seeAll: 'Eeg dhammaan kaararka hadiyadda', shopBrand: 'Iibso kaararka hadiyadda {brand}', giftCards: 'Kaararka hadiyadda',
  howSub: 'Saddex tallaabo, badanaa wax ka yar hal daqiiqo.',
  s1h: '1. Dooro kaar', s1p: 'Dooro summadda iyo qiimaha. Qiimuhu waa Birr waxaana horey ugu jira VAT {vat}%.',
  s2h: '2. Ku bixi M-Pesa', s2p: 'Geli lambarkaaga M-Pesa. Ku ansixi lacag bixinta taleefankaaga adigoo isticmaalaya PIN-kaaga.',
  s3h: '3. Hel koodkaaga', s3p: 'Koodkaagu wuxuu ka muuqdaa shaashadda iyo “Dalabaadkayga”, waxaanan kuugu soo dirnaa SMS ama iimayl.',
  tr1h: 'Gaarsiin degdeg ah', tr1p: 'Kaararka jira waxay yimaadaan ilbiriqsiyo kadib lacag bixinta.', tr2h: 'Lacag bixin M-Pesa oo ammaan ah', tr2p: 'Lacag bixin kasta adigaa ku ansixiya taleefankaaga.',
  tr3h: 'VAT ku jiro', tr3p: 'Qiimaha aad aragto waa qiimaha aad bixiso.', tr4h: 'Caawimaad maalin kasta', tr4p: '{from}–{to} taleefan, Telegram ama iimayl.', tr4p0: 'Taleefan, Telegram ama iimayl.',
  noFound: 'Lama helin kaar hadiyad', noMatch: 'Waxba lama mid ah “{q}”.', noMatchIn: 'Waxba lama mid ah “{q}” gudaha {cat}.', tryAnother: 'Isku day magac ama qayb kale.', showAll: 'Tus dhammaan kaararka hadiyadda',
  allSub: '{n} summadood · koodad dhijitaal ah oo lagu gaarsiiyo SMS ama iimayl', searchBrands: 'Raadi summadaha', sort: 'Kala saar', sortPop: 'Kuwa ugu caansan', sortPrice: 'Qiimaha ugu hooseeya', sortAz: 'Magaca A–Z',
  naH: 'Kaarkan hadiyadda lama heli karo', naP: 'Waxaa laga yaabaa in laga saaray dukaanka.', crumbHome: 'Bogga hore', crumbs: 'Waddada bogga',
  cardTitle: 'Kaarka hadiyadda {name}', pdSub: 'Kood dhijitaal ah · lagu gaarsiiyo SMS ama iimayl · in lagu isticmaalo Itoobiya', chooseVal: 'Dooro qiimaha', vatIncl: 'VAT ku jiro ({vat})',
  avPreB: 'Wuu dhammaaday, dalab hore ayaa la heli karaa.', avPre: 'Hadda ayaad bixinaysaa, waxaanan koodkaaga kuu soo diraynaa isla marka uu yimaado, waxaa la filayaa {date}.',
  avLowB: '{n} kaliya ayaa haray.', avLow: 'Isla markiiba ayaa la gaarsiiyaa lacag bixinta kadib.', avOkB: 'Waa diyaar.', avOk: 'Koodkaaga waxaa la gaarsiiyaa ilbiriqsiyo kadib lacag bixinta.',
  qty: 'Tirada', less: 'Mid ka dhim', more: 'Mid ku dar', addCart: 'Ku dar dambiisha', buyNow: 'Hadda iibso', preNow: 'Hadda dalab hore samee',
  n1: 'Ku bixi M-Pesa lambar kasta oo mobayl Itoobiyaan ah.', n2: 'Koodka waxaan kuugu dirnaa SMS ama iimayl, wuxuuna ku jiraa “Dalabaadkayga”.', n3: 'Koodadka dhijitaalka ah lama celin karo lacagtana lama celiyo marka la gaarsiiyo. Hubi qiimaha intaadan bixin.',
  redeemH: 'Sida loo isticmaalo koodkaaga {brand}', r1: 'Ka fur {brand} taleefankaaga, konsoolka ama kombiyuutarka oo gal akoonkaaga.',
  r2: 'Tag meesha kaararka hadiyadda ama koodadka (badanaa waxaa la yiraahdaa Redeem, Add funds ama Gift card).', r3: 'Ku qor koodka sida uu u muuqdo. Qiimaha isla markiiba ayaa lagu darayaa hadhaagaaga.',
  alsoLike: 'Waxaa laga yaabaa inaad sidoo kale jeclaato',
  cartH: 'Dambiishaada', cartEmptyH: 'Dambiishaadu waa madhan tahay', cartEmptyP: 'Ku dar kaar hadiyad wuxuuna halkan ka muuqan doonaa.', cards1: '1 kaar', cardsN: '{n} kaar',
  each: 'Midkiiba {price} · VAT ku jiro', qtyOf: 'Tirada {name}', remove: 'Ka saar', preExp: 'Dalab hore · waxaa la filayaa {date}',
  summary: 'Soo koobid', subtotal: 'Wadarta hoose', vatPctL: 'VAT ku jiro ({vat}%)', delivery: 'Gaarsiin', deliveryFree: 'Bilaash · SMS ama iimayl', total: 'Wadarta',
  checkout: 'U gudub lacag bixinta', signToCheck: 'Gal si aad u bixiso', payWith: 'Ku bixi', preFine: 'Kaararka dalabka hore hadda ayaa la bixiyaa, waxaana la diraa marka ay yimaadaan.', noRefundFine: 'Koodadka dhijitaalka ah lacagtooda lama celiyo marka la gaarsiiyo.',
  showCode: 'Tus koodka', hideCode: 'Qari koodka', copyCode: 'Koobi koodka',
  signSeeH: 'Gal si aad u aragto dalabaadkaaga', signSeeP: 'Isticmaal lambarka aad ku bixisay. Koodadkaagu halkaas ayay ku kaydsan yihiin.', noOrdersH: 'Weli dalab ma jiro', noOrdersP: 'Kaararka hadiyadda aad iibsato halkan ayay kula soo baxaan koodadkooda.',
  signedAs: 'Waxaad u gashay {name} · {phone}', stDelivered: 'La gaarsiiyay', stPartly: 'Qayb ahaan la gaarsiiyay', stWaiting: 'Sugaya kaarka', mpesaApp: 'Abka M-Pesa',
  expBy: 'Waxaa la filayaa {date}', paidWait: 'Waa la bixiyay. Koodka waxaan dirnaa isla marka kaarku yimaado.', paidMpesa: 'Lagu bixiyay M-Pesa', sentSms: 'Koodadka waxaa SMS loogu diray {to}', sentMail: 'Koodadka waxaa loo diray {to}', cardOf: 'Kaar {v}',
  helpSub: 'Jawaabaha su’aalaha caadiga ah, sida nalaga helo, iyo siyaasadahayaga.', call: 'Na soo wac', emailL: 'Iimayl',
  q1: 'Intee in le’eg ayaan ku helayaa koodkayga?', a1: 'Kaararka jira waxaa la gaarsiiyaa ilbiriqsiyo kadib markaad ansixiso lacag bixinta M-Pesa. Koodka wuxuu ka muuqdaa shaashadda, “Dalabaadkayga”, iyo SMS ama iimayl.',
  q2: 'Sideen u bixiyaa?', a2: 'M-Pesa. Geli lambarkaaga M-Pesa marka aad bixinayso oo ku ansixi codsiga lacag bixinta taleefankaaga adigoo isticmaalaya PIN-kaaga. Weligeen PIN-kaaga kuma weydiino boggan.',
  q3: 'Waa maxay dalab hore?', a3: 'Marka kaar dhammaado weli waad iibsan kartaa. Hadda ayaad bixinaysaa, koodkana si toos ah ayaan u diraynaa marka kaarku yimaado. Taariikhda la filayo waa lagu tusayaa intaadan bixin.',
  q4: 'Ma u diri karaa kaar hadiyad qof kale?', a4: 'Haa. Marka aad bixinayso dooro SMS ama iimayl oo geli lambarkooda ama iimaylkooda. Koodka si toos ah ayay u helayaan.',
  q5: 'Lacagta ma la ii celin karaa?', a5: 'Maya. Koodadka kaararka hadiyadda waa dhijitaal, lama celin karo lacagtana lama celiyo marka la gaarsiiyo. Haddii kood uusan shaqeyn, nala soo xiriir waan ku caawin doonaa.',
  q6: 'Ma u baahanahay akoon?', a6: 'Waxaad ku galaysaa lambarkaaga taleefanka iyo kood SMS ah oo hal mar ah. Taasi waxay dalabaadkaaga iyo koodadkaaga ku haysaa hal meel.',
  termsP1: 'eCards waxay iibisaa koodad kaar hadiyadeed oo dhijitaal ah oo loogu talagalay summadaha la muujiyay. Qiimuhu waa Birr Itoobiyaan waxaana ku jira VAT {vat}%. Dalabku wuxuu xaqiijmaa marka M-Pesa xaqiijiso lacag bixintaada.',
  termsP2: 'Koodadku waa isticmaal shakhsi oo kaliya lamana iibin karo mar kale. Shuruudaha summad kasta ayaa khuseeya marka aad isticmaasho kood.',
  refundP1: 'Dhammaan iibku waa kama dambays. Koodadka kaararka hadiyadda lama celin karo, lama beddeli karo, lacagtana lama celiyo marka la gaarsiiyo, sababtoo ah kood la gaarsiiyay isla markiiba waa la isticmaali karaa.',
  refundP2: 'Haddii kood uusan shaqeyn, ama dalab hore uu daaho, nagala soo xiriir lambarka dalabkaaga waan saxaynaa.',
  privP1: 'Waxaan haynaa magacaaga, lambarkaaga taleefanka, iimaylka ama lambarka aad koodadka u dirto, iyo dalabaadkaaga. Waxaan u isticmaalnaa inaan koodadkaaga gaarsiinno oo aan ku caawinno. Xogtaada ma iibinno.',
  privP2: 'Lacag bixinta waxaa maamula M-Pesa; weligeen ma aragno mana kaydinno PIN-kaaga M-Pesa.',
  contactHours: 'Maalin kasta, {from}–{to}', replySoon: 'Sida ugu dhaqsaha badan ayaan ku jawaabnaa', contactSoon: 'Faahfaahinta xiriirka dhowaan ayay imaan doontaa.',
  tHome: 'Kaararka hadiyadda Itoobiya, ku bixi M-Pesa',
  maxBuy: 'Kaarkan hal mar waxaad ka iibsan kartaa ilaa {n}', added: '{n} × {name} waxaa lagu daray dambiishaada', removed: '{name} waa laga saaray', codeCopied: 'Koodka waa la koobiyeeyay', copyNA: 'Halkan koobi lama samayn karo · dooro koodka si aad u koobiyeyso',
  arrived: 'Kaarkii aad horay u dalbatay wuu yimid. Koodku wuxuu ku jiraa “Dalabaadkayga”.', previewNote: 'Daaqadda horudhaca: dukaanku halkan wuu ka shaqeeyaa, laakiin ka fur web.html galka si aad xog ula wadaagto maamulka.',
  signedOut: 'Waad ka baxday', welcome: 'Soo dhawoow, {name}', signedInAs: 'Waxaad u gashay {name}', newCode: 'Kood cusub ayaa la diray · tijaabo: shaashadda ayuu ka muuqdaa',
  close: 'Xir', siH: 'Gal ama samee akoon', siP: 'Waxaan taleefankaaga u diraynaa kood 6 god ah. Isticmaal lambarka aad ku bixiso M-Pesa.', phoneL: 'Lambarka taleefanka', sendCode: 'Dir koodka',
  agreeFine: 'Haddii aad sii wadato waxaad ogolaatay shuruudahayaga iyo siyaasadda asturnaanta.', codeH: 'Geli koodka', codeP: 'Waxaan kood 6 god ah u dirnay {phone}.', demoCode: 'Tijaabo: SMS lama diro. Koodkaagu waa {code}.',
  code6: 'Kood 6 god ah', changeNum: 'Beddel lambarka', resendIn: 'Mar kale dir {s} ilbiriqsi kadib', resendNew: 'Dir kood cusub', cont: 'Sii wad',
  welcomeH: 'Ku soo dhawoow eCards', welcomeP: 'Hal shay oo kama dambays ah: maxaan kuugu yeernaa? Waxaad ku dari kartaa iimayl si aad koodadka halkaas ugu hesho.', yourName: 'Magacaaga', namePh: 'Tusaale ahaan Hodan Cali', optional: '(ikhtiyaari)',
  errName: 'Geli magacaaga.', errMail: 'Geli iimayl sax ah, ama ka tag madhan.', createAcc: 'Samee akoon', errPhone0: 'Geli lambarkaaga taleefanka.',
  errPhone: 'Geli lambar mobayl Itoobiyaan ah oo sax ah, sida 0912 345 678 ama 0712 345 678.', err6: 'Geli 6-da god ee SMS-ka.', errCode: 'Koodkaasi waa khalad. Eeg SMS-ka oo isku day mar kale.', errCode3: 'Koodkaasi waa khalad. Dir kood cusub oo isku day mar kale.',
  coH: 'Lacag bixinta', preTag: 'dalab hore', totVat: 'Wadarta, VAT ku jiro', sendBy: 'Koodadka u dir', sms: 'SMS', smsPhone: 'Lambarka taleefanka ee SMS-ka', giftHintP: 'Lambarkaaga ama mid qof kale, si aad hadiyad ahaan ugu dirto.',
  emailAddr: 'Ciwaanka iimaylka', giftHintE: 'Kaaga ama mid qof kale, si aad hadiyad ahaan ugu dirto.', payNum: 'Lambarka M-Pesa ee aad ku bixinayso', payHint: 'Taleefankan ayaad ka heli doontaa codsi lacag bixin. Ha la wadaagin PIN-kaaga.',
  preNoteAll: 'Kaararkan way dhammaadeen. Hadda ayaad bixinaysaa, koodadkana waan diraynaa marka ay yimaadaan, waxaa la filayaa {date}.', preNoteSome: 'Kaararka qaar way dhammaadeen. Hadda ayaad bixinaysaa, koodadkooda waan diraynaa marka ay yimaadaan, waxaa la filayaa {date}.',
  agreeChk: 'Waan fahamsanahay in koodadka kaararka hadiyaddu yihiin dhijitaal oo lacagtooda aan la celin marka la gaarsiiyo.', payBtn: 'Ku bixi {amount} M-Pesa',
  stkH: 'Eeg taleefankaaga', stkP: 'Waxaan u dirnay codsi lacag bixin oo {amount} ah {phone}. Fur fariinta M-Pesa oo geli PIN-kaaga si aad u ansixiso.', waitAppr: 'Sugaya ansixinta · {t}',
  stkDemo: 'Tijaabo: codsi lacag bixin lama diro. Dooro waxa ka dhacaya taleefanka:', decline: 'Ku diid taleefanka', approve: 'Ku ansixi taleefanka', cancelPay: 'Jooji lacag bixinta',
  confirming: 'Xaqiijinaya', confH: 'Waxaan xaqiijinaynaa lacag bixintaada', confP: 'Waxay qaadanaysaa dhowr ilbiriqsi. Ha xirin daaqaddan.', doneH: 'Lacagta waa la helay', orderL: 'Dalab {id} · {amount}',
  sendSms: 'Koodadka waxaan SMS ugu diraynaa {to}.', sendSmsLater: 'Koodadka waxaan SMS ugu diri doonaa {to} marka ay yimaadaan.', sendMail: 'Koodadka waxaan u diraynaa {to}.', sendMailLater: 'Koodadka waxaan u diri doonaa {to} marka ay yimaadaan.',
  demoNothing: 'Tijaabo: waxba lama diro.', keepShop: 'Sii wad wax iibsiga', viewOrders: 'Eeg dalabaadkayga',
  declH: 'Lacag bixinta waa la diiday', expH: 'Codsiga lacag bixinta wuu dhacay', cancH: 'Lacag bixinta waa la joojiyay', declP: 'Lacag bixinta waxaa lagu diiday taleefanka.', expP: 'Codsiga lama ansixin waqtigiisii.', cancP: 'Waxaad joojisay lacag bixinta.',
  notCharged: 'Waxba lagaama jarin, dambiishaaduna waa kaydsan tahay.', backCart: 'Ku noqo dambiisha', tryAgain: 'Isku day mar kale',
  errTo0Sms: 'Geli lambarka taleefanka ee koodadka loo dirayo.', errToSms: 'Geli lambar mobayl Itoobiyaan ah oo sax ah oo SMS-ka loogu diro.', errTo0Mail: 'Geli iimaylka koodadka loo dirayo.', errToMail: 'Geli iimayl sax ah.',
  errPay: 'Geli lambarka M-Pesa ee aad ku bixinayso.', errAgree: 'Fadlan xaqiiji inaad fahamsan tahay in koodadka lacagtooda aan la celin.'
};
WEB_I18N.ti = {
  homeAria: 'መበገሲ eCards', navGift: 'ናይ ህያብ ካርድታት', navHow: 'ብኸመይ ይሰርሕ', navHelp: 'ሓገዝ', mainNav: 'ቀንዲ ዝርዝር',
  searchLbl: 'ናይ ህያብ ካርድታት ድለ', searchPh: 'Netflix፣ PlayStation… ድለ', search: 'ድለ',
  myOrders: 'ትእዛዛተይ', helpContact: 'ሓገዝን ርክብን', signOut: 'ውጻእ', signIn: 'እቶ', cartAria: 'ዘንቢል፣ {n}', language: 'ቋንቋ',
  footBlurb: 'ንኢትዮጵያ ዝኾኑ ዲጂታላዊ ናይ ህያብ ካርድታት፣ ዋጋኦም ብብር ተ.እ.ታ ሓዊሱ። ብM-Pesa ክፈል፣ ኮድካ ብኤስኤምኤስ ወይ ብኢመይል ርኸብ። ኣብ ውሽጢ ኣፕ M-Pesa’ውን ይርከብ።',
  shop: 'ዕድግ', allCards: 'ኩሎም ናይ ህያብ ካርድታት', qa: 'ሕቶታትን መልስታትን', contactUs: 'ርኸቡና', everyDay: 'መዓልታዊ {from}–{to}', legal: 'ሕጋዊ',
  terms: 'ውዕል ኣገልግሎት', privacy: 'ፖሊሲ ብሕትውና', norefund: 'ፖሊሲ ዘይምምላስ ገንዘብ',
  footPrices: 'ዋጋታት ብብር ኢትዮጵያ (ETB)፣ ተ.እ.ታ ሓዊሱ', footDemo: 'ናይ ፈተነ ድኳን፦ ናይ ሓቂ ክፍሊት፣ ኤስኤምኤስ ወይ ኮድ የለን',
  cat_gaming: 'ጸወታታት', cat_apps: 'ኣፕታት', cat_video: 'ፊልምን ቪድዮን', cat_music: 'ሙዚቃ', cat_telecom: 'ካርድ ተሌፎን', cat_card: 'ናይ ህያብ ካርድታት', catAll: 'ኩሉ', category: 'ምድብ',
  preorder: 'ቅድሚ ትእዛዝ', instant: 'ብቕጽበት', onlyLeft: '{n} ጥራይ ተሪፎም', from: 'ካብ', cardAria: 'ናይ {name} ህያብ ካርድ፣ ካብ {price}',
  eyebrow: 'ብቕጽበት ይበጽሕ · ብM-Pesa ክፈል', heroH: 'ንእትፈትዎም ጸወታታት፣ ሙዚቃን ፊልምታትን ናይ ህያብ ካርድታት',
  heroP: 'Netflix፣ PlayStation፣ Spotify፣ Steam ከምኡውን ካልኦት፣ ዋጋኦም ብብር ተ.እ.ታ ሓዊሱ። ብM-Pesa ክፈል፣ ኮድካ ኣብ ሒደት ካልኢታት ብኤስኤምኤስ ወይ ብኢመይል ርኸብ።',
  browse: 'ናይ ህያብ ካርድታት ርአ', pt1: 'ኮድ ኣብ ሒደት ካልኢታት', pt2: 'ዋጋ ብብር፣ ተ.እ.ታ ሓዊሱ', pt3: 'መዓልታዊ ደገፍ',
  popular: 'ፍሉጣት ብራንድታት', seeAll: 'ኩሎም ናይ ህያብ ካርድታት ርአ', shopBrand: 'ናይ {brand} ህያብ ካርድታት ዕደግ', giftCards: 'ናይ ህያብ ካርድታት',
  howSub: 'ሰለስተ ስጉምትታት፣ መብዛሕትኡ ግዜ ካብ ሓንቲ ደቒቕ ንታሕቲ።',
  s1h: '1. ካርድ ምረጽ', s1p: 'ብራንድን መጠንን ምረጽ። ዋጋታት ብብር እዮም፣ {vat}% ተ.እ.ታ ድማ ሓዊሶም።',
  s2h: '2. ብM-Pesa ክፈል', s2p: 'ቁጽሪ M-Pesa ኣእቱ። ነቲ ክፍሊት ኣብ ስልኪኻ ብፒንካ ኣጽድቖ።',
  s3h: '3. ኮድካ ርኸብ', s3p: 'ኮድካ ኣብ ስክሪንን ኣብ «ትእዛዛተይ»ን ይርአ፣ ብኤስኤምኤስ ወይ ብኢመይል’ውን ንሰደልካ።',
  tr1h: 'ቅልጡፍ ኣቕርቦት', tr1p: 'ዘለዉ ካርድታት ድሕሪ ክፍሊት ኣብ ሒደት ካልኢታት ይበጽሑ።', tr2h: 'ውሑስ ክፍሊት M-Pesa', tr2p: 'ነፍሲ ወከፍ ክፍሊት ኣብ ናትካ ስልኪ ባዕልኻ ተጽድቖ።',
  tr3h: 'ተ.እ.ታ ሓዊሱ', tr3p: 'እትርእዮ ዋጋ እትኸፍሎ ዋጋ እዩ።', tr4h: 'መዓልታዊ ሓገዝ', tr4p: '{from}–{to} ብስልኪ፣ ብቴሌግራም ወይ ብኢመይል።', tr4p0: 'ብስልኪ፣ ብቴሌግራም ወይ ብኢመይል።',
  noFound: 'ናይ ህያብ ካርድ ኣይተረኽበን', noMatch: 'ምስ «{q}» ዝሰማማዕ የለን።', noMatchIn: 'ኣብ {cat} ምስ «{q}» ዝሰማማዕ የለን።', tryAnother: 'ካልእ ስም ወይ ምድብ ፈትን።', showAll: 'ኩሎም ናይ ህያብ ካርድታት ኣርኢ',
  allSub: '{n} ብራንድታት · ዲጂታላዊ ኮዳት ብኤስኤምኤስ ወይ ብኢመይል ይበጽሑ', searchBrands: 'ብራንድታት ድለ', sort: 'ስርዓት', sortPop: 'ዝያዳ ፍሉጥ', sortPrice: 'ትሑት ዋጋ', sortAz: 'ስም ሀ–ፐ',
  naH: 'እዚ ናይ ህያብ ካርድ ኣይርከብን', naP: 'ካብቲ ድኳን ተኣልዩ ክኸውን ይኽእል።', crumbHome: 'መበገሲ', crumbs: 'መንገዲ ገጽ',
  cardTitle: 'ናይ {name} ህያብ ካርድ', pdSub: 'ዲጂታላዊ ኮድ · ብኤስኤምኤስ ወይ ብኢመይል ይበጽሕ · ኣብ ኢትዮጵያ ንምጥቃም', chooseVal: 'መጠን ምረጽ', vatIncl: 'ተ.እ.ታ ሓዊሱ ({vat})',
  avPreB: 'ተወዲኡ፣ ብቅድሚ ትእዛዝ ይርከብ።', avPre: 'ሕጂ ትኸፍል፣ እቲ ካርድ ምስ ኣተወ ኮድካ ንሰደልካ፣ ክሳዕ {date} ይጽበ።',
  avLowB: '{n} ጥራይ ተሪፎም።', avLow: 'ድሕሪ ክፍሊት ብቕጽበት ይበጽሕ።', avOkB: 'ኣሎ።', avOk: 'ኮድካ ድሕሪ ክፍሊት ኣብ ሒደት ካልኢታት ይበጽሕ።',
  qty: 'ብዝሒ', less: 'ሓደ ኣጉድል', more: 'ሓደ ወስኽ', addCart: 'ናብ ዘንቢል ወስኽ', buyNow: 'ሕጂ ዕደግ', preNow: 'ሕጂ ቅድሚ ትእዛዝ ሃብ',
  n1: 'ካብ ዝኾነ ቁጽሪ ሞባይል ኢትዮጵያ ብM-Pesa ክፈል።', n2: 'ነቲ ኮድ ብኤስኤምኤስ ወይ ብኢመይል ንሰዶ፣ ኣብ «ትእዛዛተይ»’ውን ይዕቀብ።', n3: 'ዲጂታላዊ ኮዳት ድሕሪ ምብጻሖም ኣይምለሱን፣ ገንዘብ’ውን ኣይምለስን። ቅድሚ ምኽፋልካ ነቲ መጠን ኣረጋግጽ።',
  redeemH: 'ኮድ {brand} ብኸመይ ከም እትጥቀመሉ', r1: '{brand} ኣብ ስልኪኻ፣ ኮንሶል ወይ ኮምፒተርካ ክፈቶ እሞ ናብ ሕሳብካ እቶ።',
  r2: 'ናብቲ ናይ ህያብ ካርድ ወይ ኮድ ዘእትወሉ ቦታ ኪድ (መብዛሕትኡ Redeem፣ Add funds ወይ Gift card ይበሃል)።', r3: 'ነቲ ኮድ ከም ዝረአ ብትኽክል ጸሓፎ። እቲ መጠን ብቕጽበት ናብ ሕሳብካ ይውሰኽ።',
  alsoLike: 'እዚኣቶም’ውን ክፈትዎም ትኽእል',
  cartH: 'ዘንቢልካ', cartEmptyH: 'ዘንቢልካ ባዶ እዩ', cartEmptyP: 'ናይ ህያብ ካርድ ምስ ወሰኽካ ኣብዚ ይርአ።', cards1: '1 ካርድ', cardsN: '{n} ካርድታት',
  each: 'ነፍሲ ወከፍ {price} · ተ.እ.ታ ሓዊሱ', qtyOf: 'ብዝሒ {name}', remove: 'ኣውጽእ', preExp: 'ቅድሚ ትእዛዝ · ክሳዕ {date} ይጽበ',
  summary: 'ጽማቝ', subtotal: 'ንኡስ ድምር', vatPctL: 'ተ.እ.ታ ሓዊሱ ({vat}%)', delivery: 'መበጽሒ', deliveryFree: 'ብናጻ · ኤስኤምኤስ ወይ ኢመይል', total: 'ጠቕላላ',
  checkout: 'ናብ ክፍሊት', signToCheck: 'ንምኽፋል እቶ', payWith: 'ክፍሊት ብ', preFine: 'ካርድታት ቅድሚ ትእዛዝ ሕጂ ይኽፈሉ፣ ምስ ኣተዉ ይስደዱ።', noRefundFine: 'ዲጂታላዊ ኮዳት ድሕሪ ምብጻሖም ገንዘብ ኣይምለስን።',
  showCode: 'ኮድ ኣርኢ', hideCode: 'ኮድ ሕባእ', copyCode: 'ኮድ ቅዳሕ',
  signSeeH: 'ትእዛዛትካ ንምርኣይ እቶ', signSeeP: 'እቲ ዝኸፈልካሉ ቁጽሪ ስልኪ ተጠቐም። ኮዳትካ ኣብኡ ተዓቂቦም ኣለዉ።', noOrdersH: 'ክሳዕ ሕጂ ትእዛዝ የለን', noOrdersP: 'እትዕድጎም ናይ ህያብ ካርድታት ምስ ኮዳቶም ኣብዚ ይርኣዩ።',
  signedAs: 'ከም {name} ኣቲኻ ኣለኻ · {phone}', stDelivered: 'በጺሑ', stPartly: 'ብኸፊል በጺሑ', stWaiting: 'ካርድ ይጽበ ኣሎ', mpesaApp: 'ኣፕ M-Pesa',
  expBy: 'ክሳዕ {date} ይጽበ', paidWait: 'ተኸፊሉ። እቲ ካርድ ምስ ኣተወ ነቲ ኮድ ንሰዶ።', paidMpesa: 'ብM-Pesa ተኸፊሉ', sentSms: 'ኮዳት ብኤስኤምኤስ ናብ {to} ተሰዲዶም', sentMail: 'ኮዳት ናብ {to} ተሰዲዶም', cardOf: 'ካርድ {v}',
  helpSub: 'መልሲ ንልሙዳት ሕቶታት፣ ንዓና እትረኽቡሉ መገድታትን ፖሊሲታትናን።', call: 'ደውሉልና', emailL: 'ኢመይል',
  q1: 'ኮደይ ክንደይ ቀልጢፉ እረኽቦ?', a1: 'ዘለዉ ካርድታት ክፍሊት M-Pesa ምስ ኣጽደቕካ ኣብ ሒደት ካልኢታት ይበጽሑ። እቲ ኮድ ኣብ ስክሪን፣ ኣብ «ትእዛዛተይ» ከምኡውን ብኤስኤምኤስ ወይ ብኢመይል ይበጽሓካ።',
  q2: 'ብኸመይ እኸፍል?', a2: 'ብM-Pesa። ኣብ ግዜ ክፍሊት ቁጽሪ M-Pesa ኣእቱ እሞ ነቲ ኣብ ስልኪኻ ዝመጽእ ሕቶ ክፍሊት ብፒንካ ኣጽድቖ። ኣብዚ መርበብ ፒንካ ፈጺምና ኣይንሓተካን።',
  q3: 'ቅድሚ ትእዛዝ እንታይ እዩ?', a3: 'ካርድ እንተተወድአ’ውን ክትዕድጎ ትኽእል። ሕጂ ትኸፍል፣ እቲ ካርድ ምስ ኣተወ ነቲ ኮድ ብኣውቶማቲክ ንሰዶ። እቲ ዝጽበ ዕለት ቅድሚ ምኽፋልካ ይርኣየካ።',
  q4: 'ናይ ህያብ ካርድ ንካልእ ሰብ ክሰድድ እኽእልዶ?', a4: 'እወ። ኣብ ግዜ ክፍሊት ኤስኤምኤስ ወይ ኢመይል ምረጽ እሞ ቁጽሪ ስልኪ ወይ ኢመይል ናይቲ ሰብ ኣእቱ። እቲ ኮድ ብቐጥታ ይበጽሖም።',
  q5: 'ገንዘበይ ክምለሰለይ ይኽእልዶ?', a5: 'ኣይፋል። ኮዳት ናይ ህያብ ካርድ ዲጂታላውያን እዮም፣ ድሕሪ ምብጻሖም ኣይምለሱን ገንዘብ’ውን ኣይምለስን። ኮድ እንተዘይሰሪሑ ርኸቡና፣ ክንሕግዘኩም ኢና።',
  q6: 'ሕሳብ የድልየኒዶ?', a6: 'ብቁጽሪ ስልኪኻን ብሓንሳብ ዝሰርሕ ኮድ ኤስኤምኤስን ትኣቱ። እዚ ትእዛዛትካን ኮዳትካን ኣብ ሓደ ቦታ ይሕዞ።',
  termsP1: 'eCards ንዝተራእዩ ብራንድታት ዘገልግሉ ዲጂታላዊ ኮዳት ናይ ህያብ ካርድ ይሸይጥ። ዋጋታት ብብር ኢትዮጵያ ኮይኖም {vat}% ተ.እ.ታ ሓዊሶም። ትእዛዝ ዝረጋገጽ M-Pesa ክፍሊትካ ምስ ኣረጋገጸ እዩ።',
  termsP2: 'ኮዳት ንውልቃዊ ጥቕሚ ጥራይ እዮም፣ ዳግማይ ክሽየጡ ኣይክእሉን። ኮድ ክትጥቀም ከለኻ ውዕል ነፍሲ ወከፍ ብራንድ ይትግበር።',
  refundP1: 'ኩሉ መሸጣ ናይ መወዳእታ እዩ። ዝበጽሐ ኮድ ብቕጽበት ክጥቀመሉ ስለዝኽእል፣ ኮዳት ናይ ህያብ ካርድ ድሕሪ ምብጻሖም ኣይምለሱን፣ ኣይቅየሩን፣ ገንዘብ’ውን ኣይምለስን።',
  refundP2: 'ኮድ እንተዘይሰሪሑ ወይ ቅድሚ ትእዛዝ እንተደንጒዩ፣ ብቁጽሪ ትእዛዝካ ርኸቡና፣ ነቲ ጸገም ክንፈትሖ ኢና።',
  privP1: 'ስምካ፣ ቁጽሪ ስልኪኻ፣ ኮዳት ዝስደድሉ ኢመይል ወይ ቁጽሪ ከምኡውን ትእዛዛትካ ንሕዝ። ኮዳትካ ንምብጻሕን ንዓኻ ንምሕጋዝን ንጥቀመሎም። ሓበሬታኻ ኣይንሸጦን።',
  privP2: 'ክፍሊታት ብM-Pesa ይካየዱ፤ ፒን M-Pesa ናትካ ፈጺምና ኣይንርእዮን ኣይንዕቅቦን።',
  contactHours: 'መዓልታዊ፣ {from}–{to}', replySoon: 'ብዝተኻእለ ቅልጡፍ ንምልስ', contactSoon: 'ሓበሬታ ርክብ ቀልጢፉ ክመጽእ እዩ።',
  tHome: 'ኣብ ኢትዮጵያ ናይ ህያብ ካርድታት፣ ብM-Pesa ክፈል',
  maxBuy: 'ካብዚ ካርድ ብሓንሳብ ክሳዕ {n} ክትዕድግ ትኽእል', added: '{n} × {name} ናብ ዘንቢልካ ተወሲኹ', removed: '{name} ወጺኡ', codeCopied: 'እቲ ኮድ ተቐዲሑ', copyNA: 'ኣብዚ ምቕዳሕ ኣይከኣልን · ነቲ ኮድ መሪጽካ ቅዳሕ',
  arrived: 'ብቅድሚ ትእዛዝ ዝኣዘዝካዮ ካርድ በጺሑ። እቲ ኮድ ኣብ «ትእዛዛተይ» ኣሎ።', previewNote: 'መስኮት ቅድመ-ርእይቶ፦ እቲ ድኳን ኣብዚ ይሰርሕ፣ ምስ ኣመሓዳሪ ሓበሬታ ንምክፋል ግን web.html ካብቲ ማህደር ክፈት።',
  signedOut: 'ወጺእካ', welcome: 'እንቋዕ ብደሓን መጻእካ፣ {name}', signedInAs: 'ከም {name} ኣቲኻ', newCode: 'ሓድሽ ኮድ ተሰዲዱ · ፈተነ፦ ኣብ ስክሪን ይርአ',
  close: 'ዕጸው', siH: 'እቶ ወይ ሕሳብ ፍጠር', siP: 'ባለ 6 ቁጽሪ ኮድ ናብ ስልኪኻ ንሰድድ። እቲ ብM-Pesa እትኸፍለሉ ቁጽሪ ተጠቐም።', phoneL: 'ቁጽሪ ስልኪ', sendCode: 'ኮድ ስደድ',
  agreeFine: 'ብምቕጻልካ ምስ ውዕልናን ፖሊሲ ብሕትውናናን ትሰማማዕ።', codeH: 'ነቲ ኮድ ኣእቱ', codeP: 'ባለ 6 ቁጽሪ ኮድ ናብ {phone} ሰዲድና።', demoCode: 'ፈተነ፦ ኤስኤምኤስ ኣይስደድን። ኮድካ {code} እዩ።',
  code6: 'ባለ 6 ቁጽሪ ኮድ', changeNum: 'ቁጽሪ ቀይር', resendIn: 'ድሕሪ {s} ካልኢት ደጊምካ ስደድ', resendNew: 'ሓድሽ ኮድ ስደድ', cont: 'ቀጽል',
  welcomeH: 'ናብ eCards እንቋዕ ብደሓን መጻእካ', welcomeP: 'ሓደ ናይ መወዳእታ ነገር፦ ብምንታይ ንጸውዓካ? ኮዳት ብኢመይል ንምርካብ ኢመይል ክትውስኽ ትኽእል።', yourName: 'ስምካ', namePh: 'ንኣብነት ሰላም ኣብርሃ', optional: '(ኣማራጺ)',
  errName: 'ስምካ ኣእቱ።', errMail: 'ቅኑዕ ኢመይል ኣእቱ ወይ ባዶ ግደፎ።', createAcc: 'ሕሳብ ፍጠር', errPhone0: 'ቁጽሪ ስልኪኻ ኣእቱ።',
  errPhone: 'ቅኑዕ ቁጽሪ ሞባይል ኢትዮጵያ ኣእቱ፣ ንኣብነት 0912 345 678 ወይ 0712 345 678።', err6: 'ካብቲ ኤስኤምኤስ 6ቱ ቁጽርታት ኣእቱ።', errCode: 'እቲ ኮድ ጌጋ እዩ። ነቲ ኤስኤምኤስ ርኢኻ ደጊምካ ፈትን።', errCode3: 'እቲ ኮድ ጌጋ እዩ። ሓድሽ ኮድ ኣስዲድካ ደጊምካ ፈትን።',
  coH: 'ክፍሊት', preTag: 'ቅድሚ ትእዛዝ', totVat: 'ጠቕላላ፣ ተ.እ.ታ ሓዊሱ', sendBy: 'ኮዳት ዝስደዱሉ', sms: 'ኤስኤምኤስ', smsPhone: 'ኤስኤምኤስ ዝስደደሉ ቁጽሪ ስልኪ', giftHintP: 'ናትካ ወይ ናይ ካልእ ሰብ ቁጽሪ፣ ብህያብ ንምስዳድ።',
  emailAddr: 'ኣድራሻ ኢመይል', giftHintE: 'ናትካ ወይ ናይ ካልእ ሰብ፣ ብህያብ ንምስዳድ።', payNum: 'እትኸፍለሉ ቁጽሪ M-Pesa', payHint: 'ኣብዚ ስልኪ ሕቶ ክፍሊት ክበጽሓካ እዩ። ፒንካ ንማንም ኣይተካፍል።',
  preNoteAll: 'እዞም ካርድታት ተወዲኦም። ሕጂ ትኸፍል፣ ምስ ኣተዉ ኮዳት ንሰደልካ፣ ክሳዕ {date} ይጽበዩ።', preNoteSome: 'ገለ ካርድታት ተወዲኦም። ሕጂ ትኸፍል፣ ምስ ኣተዉ ኮዳቶም ንሰደልካ፣ ክሳዕ {date} ይጽበዩ።',
  agreeChk: 'ኮዳት ናይ ህያብ ካርድ ዲጂታላውያን ምዃኖምን ድሕሪ ምብጻሖም ገንዘብ ከም ዘይምለስን ተረዲኡኒ።', payBtn: '{amount} ብM-Pesa ክፈል',
  stkH: 'ስልኪኻ ርአ', stkP: 'ሕቶ ክፍሊት {amount} ናብ {phone} ሰዲድና። መልእኽቲ M-Pesa ከፊትካ ንምጽዳቕ ፒንካ ኣእቱ።', waitAppr: 'ምጽዳቕ ይጽበ ኣሎ · {t}',
  stkDemo: 'ፈተነ፦ ሕቶ ክፍሊት ኣይስደድን። ኣብቲ ስልኪ ዝኸውን ምረጽ፦', decline: 'ብስልኪ ኣይትቀበል', approve: 'ብስልኪ ኣጽድቕ', cancelPay: 'ክፍሊት ሰርዝ',
  confirming: 'የረጋግጽ ኣሎ', confH: 'ክፍሊትካ ነረጋግጽ ኣለና', confP: 'ሒደት ካልኢታት ይወስድ። ነዚ መስኮት ኣይትዕጸዎ።', doneH: 'ክፍሊት በጺሑና', orderL: 'ትእዛዝ {id} · {amount}',
  sendSms: 'ኮዳት ብኤስኤምኤስ ናብ {to} ንሰድድ ኣለና።', sendSmsLater: 'ኮዳት ምስ ኣተዉ ብኤስኤምኤስ ናብ {to} ክንሰዶም ኢና።', sendMail: 'ኮዳት ናብ {to} ንሰድድ ኣለና።', sendMailLater: 'ኮዳት ምስ ኣተዉ ናብ {to} ክንሰዶም ኢና።',
  demoNothing: 'ፈተነ፦ ዝኾነ ነገር ኣይስደድን።', keepShop: 'ምዕዳግ ቀጽል', viewOrders: 'ትእዛዛተይ ርአ',
  declH: 'ክፍሊት ተነጺጉ', expH: 'ሕቶ ክፍሊት ግዜኡ ሓሊፉ', cancH: 'ክፍሊት ተሰሪዙ', declP: 'እቲ ክፍሊት ኣብ ስልኪ ተነጺጉ።', expP: 'እቲ ሕቶ ብግዜኡ ኣይጸደቐን።', cancP: 'ነቲ ክፍሊት ሰሪዝካዮ።',
  notCharged: 'ዝኾነ ገንዘብ ኣይተቘርጸን፣ ዘንቢልካ ተዓቂቡ ኣሎ።', backCart: 'ናብ ዘንቢል ተመለስ', tryAgain: 'ደጊምካ ፈትን',
  errTo0Sms: 'ኮዳት ዝስደድሉ ቁጽሪ ስልኪ ኣእቱ።', errToSms: 'ንኤስኤምኤስ ቅኑዕ ቁጽሪ ሞባይል ኢትዮጵያ ኣእቱ።', errTo0Mail: 'ኮዳት ዝስደድሉ ኢመይል ኣእቱ።', errToMail: 'ቅኑዕ ኢመይል ኣእቱ።',
  errPay: 'እትኸፍለሉ ቁጽሪ M-Pesa ኣእቱ።', errAgree: 'ኮዳት ገንዘብ ከም ዘይምለሶም ከም ዝተረዳእካ ኣረጋግጽ።'
};

/* text for search engines, structured data, price tables and AI summaries */
Object.assign(WEB_I18N.en, {
  catH: '{cat} gift cards', catIntro: 'All our {cat} gift cards, priced in Birr with VAT included. Pay with M-Pesa and get the code in seconds.',
  valName: '{brand} {v} gift card', priceTblH: '{brand} gift card prices in Birr', thValue: 'Card value', thPrice: 'Price (Birr)', thVat: 'VAT included', thAvail: 'Availability', availInS: 'In stock',
  updated: 'Prices updated {date}. 1 US dollar = Br {rate}.',
  brandIntro: 'Buy a {brand} gift card in Ethiopia and pay in Birr with M-Pesa. Cards from {lo} to {hi} cost {plo} to {phi}, including {vat}% VAT. Your code is delivered by SMS or email, usually within seconds.',
  valIntro: 'The {brand} {v} gift card costs {price} in Ethiopia, including {vatAmt} VAT. Pay with M-Pesa from any Ethiopian mobile number and get your code by SMS or email.',
  bfaqH: '{brand} gift card questions',
  bq1: 'How much is a {brand} gift card in Ethiopia?', ba1: 'A {brand} gift card costs {list}, including {vat}% VAT.',
  bq2: 'How do I get my {brand} code?', ba2: 'Pay with M-Pesa and the code appears on screen and in My orders straight away. We also send it by SMS or email. Cards that are out of stock are sent as soon as they arrive.',
  bq3: 'Can I send a {brand} gift card to someone else?', ba3: 'Yes. At checkout choose SMS or email and enter their phone number or email address. They receive the code directly.',
  bq4: 'Can I get a refund on a {brand} code?', ba4: 'No. Digital codes can’t be returned or refunded once delivered. If a code doesn’t work, contact eCards support and we will help.',
  seoHomeT: 'Buy Gift Cards in Ethiopia with M-Pesa | eCards', seoHomeD: 'Netflix, PlayStation, Steam, Spotify and more gift cards in Ethiopia. Prices in Birr with VAT included. Pay with M-Pesa and get your code by SMS or email in seconds.',
  seoAllT: 'All Gift Cards in Ethiopia, Prices in Birr | eCards', seoAllD: 'Compare {n} gift card brands sold in Ethiopia. See prices in Birr with VAT, pay with M-Pesa and get instant delivery by SMS or email.',
  seoCatT: '{cat} Gift Cards in Ethiopia | eCards', seoCatD: 'Buy {cat} gift cards in Ethiopia: {brands}. Prices in Birr with VAT included, pay with M-Pesa, instant delivery by SMS or email.',
  seoBrandT: '{brand} Gift Card Ethiopia, from {price} | eCards', seoBrandD: 'Buy a {brand} gift card in Ethiopia from {price} ({range}). Pay with M-Pesa, VAT included, code delivered by SMS or email in seconds.',
  seoValT: '{brand} {v} Gift Card, {price} in Ethiopia | eCards', seoValD: '{brand} {v} gift card for {price} including {vat}% VAT. Pay with M-Pesa and get your code by SMS or email. {avail}',
  availIn: 'In stock, instant delivery.', availPreS: 'Pre-order, expected by {date}.',
  seoHelpT: 'Help, FAQ and Policies | eCards', seoHelpD: 'How to buy gift cards with M-Pesa, delivery by SMS or email, pre-orders, the no-refund policy and how to contact eCards support.',
  mdFacts: 'Key facts', mdFact1: 'Prices are in Ethiopian Birr (ETB) and include {vat}% VAT. 1 US dollar of card value = Br {rate}.',
  mdFact2: 'Payment: M-Pesa only. The customer approves the payment on their phone with their PIN.', mdFact3: 'Delivery: the code shows on screen and in My orders, and is sent by SMS or email, usually within seconds. Out-of-stock cards can be pre-ordered.',
  mdFact4: 'All sales are final: gift card codes can’t be refunded once delivered.', mdFact5: 'The store is available in English, Amharic, Afaan Oromo, Somali and Tigrinya, and inside the M-Pesa app.',
  llmsSummary: 'eCards sells digital gift cards (Netflix, PlayStation, Xbox, Steam, Apple, Google Play, Spotify, PUBG Mobile, Razer Gold, Call of Duty) to customers in Ethiopia. Prices are in Birr with {vat}% VAT included, payment is by M-Pesa, and codes are delivered by SMS or email.',
  llmsIntro: 'Each gift card page lists every card value with its price in Birr, the VAT amount and whether it is in stock. Markdown versions of the pages are linked below; the catalog JSON has the same data in one file.'
});
Object.assign(WEB_I18N.am, {
  catH: 'የ{cat} የስጦታ ካርዶች', catIntro: '{n} የ{cat} የስጦታ ካርድ ብራንዶች፣ ዋጋቸው በብር ተ.እ.ታን ጨምሮ። በM-Pesa ይክፈሉ፤ ኮዱን በሰከንዶች ውስጥ ያግኙ።',
  valName: 'የ{brand} {v} የስጦታ ካርድ', priceTblH: 'የ{brand} የስጦታ ካርድ ዋጋዎች በብር', thValue: 'የካርድ መጠን', thPrice: 'ዋጋ (ብር)', thVat: 'የተካተተ ተ.እ.ታ', thAvail: 'መገኘት', availInS: 'አለ',
  updated: 'ዋጋዎች የተሻሻሉት {date}። 1 የአሜሪካ ዶላር = {rate} ብር።',
  brandIntro: 'የ{brand} የስጦታ ካርድ በኢትዮጵያ ይግዙ፤ በብር በM-Pesa ይክፈሉ። ከ{lo} እስከ {hi} ያሉ ካርዶች ዋጋ ከ{plo} እስከ {phi} ሲሆን {vat}% ተ.እ.ታን ያካትታል። ኮድዎ በኤስኤምኤስ ወይም በኢሜይል ብዙውን ጊዜ በሰከንዶች ውስጥ ይደርሳል።',
  valIntro: 'የ{brand} {v} የስጦታ ካርድ በኢትዮጵያ ዋጋው {price} ነው፤ {vatAmt} ተ.እ.ታን ያካትታል። ከማንኛውም የኢትዮጵያ ሞባይል ቁጥር በM-Pesa ይክፈሉ፤ ኮድዎን በኤስኤምኤስ ወይም በኢሜይል ያግኙ።',
  bfaqH: 'ስለ {brand} የስጦታ ካርድ ጥያቄዎች',
  bq1: 'የ{brand} የስጦታ ካርድ በኢትዮጵያ ስንት ነው?', ba1: 'የ{brand} የስጦታ ካርድ ዋጋ {list} ሲሆን {vat}% ተ.እ.ታን ያካትታል።',
  bq2: 'የ{brand} ኮዴን እንዴት አገኛለሁ?', ba2: 'በM-Pesa ይክፈሉ፤ ኮዱ ወዲያውኑ በማያ ገጹና በ«የእኔ ትዕዛዞች» ይታያል። በኤስኤምኤስ ወይም በኢሜይልም እንልካለን። ያለቁ ካርዶች እንደገቡ ይላካሉ።',
  bq3: 'የ{brand} የስጦታ ካርድ ለሌላ ሰው መላክ እችላለሁ?', ba3: 'አዎ። በክፍያ ጊዜ ኤስኤምኤስ ወይም ኢሜይል ይምረጡና የሰውየውን ስልክ ቁጥር ወይም ኢሜይል ያስገቡ። ኮዱ በቀጥታ ይደርሳቸዋል።',
  bq4: 'ለ{brand} ኮድ ገንዘቤ ሊመለስ ይችላል?', ba4: 'አይ። ዲጂታል ኮዶች ከደረሱ በኋላ አይመለሱም፤ ገንዘብም አይመለስም። ኮድ ካልሠራ የeCards ድጋፍን ያግኙ፤ እንረዳዎታለን።',
  seoHomeT: 'በኢትዮጵያ የስጦታ ካርዶችን በM-Pesa ይግዙ | eCards', seoHomeD: 'Netflix፣ PlayStation፣ Steam፣ Spotify እና ሌሎች የስጦታ ካርዶች በኢትዮጵያ። ዋጋ በብር ተ.እ.ታን ጨምሮ። በM-Pesa ይክፈሉ፤ ኮድዎን በሰከንዶች ውስጥ በኤስኤምኤስ ወይም በኢሜይል ያግኙ።',
  seoAllT: 'ሁሉም የስጦታ ካርዶች በኢትዮጵያ፣ ዋጋ በብር | eCards', seoAllD: 'በኢትዮጵያ የሚሸጡ {n} የስጦታ ካርድ ብራንዶችን ያወዳድሩ። ዋጋዎችን በብር ተ.እ.ታን ጨምሮ ይመልከቱ፣ በM-Pesa ይክፈሉ፣ በኤስኤምኤስ ወይም በኢሜይል ወዲያውኑ ያግኙ።',
  seoCatT: 'የ{cat} የስጦታ ካርዶች በኢትዮጵያ | eCards', seoCatD: 'የ{cat} የስጦታ ካርዶችን በኢትዮጵያ ይግዙ፦ {brands}። ዋጋ በብር ተ.እ.ታን ጨምሮ፣ በM-Pesa ይክፈሉ፣ በኤስኤምኤስ ወይም በኢሜይል ወዲያውኑ ይደርሳል።',
  seoBrandT: 'የ{brand} የስጦታ ካርድ በኢትዮጵያ፣ ከ{price} | eCards', seoBrandD: 'የ{brand} የስጦታ ካርድ በኢትዮጵያ ከ{price} ጀምሮ ይግዙ ({range})። በM-Pesa ይክፈሉ፣ ተ.እ.ታ ተካቷል፣ ኮዱ በሰከንዶች ውስጥ በኤስኤምኤስ ወይም በኢሜይል ይደርሳል።',
  seoValT: 'የ{brand} {v} የስጦታ ካርድ፣ {price} በኢትዮጵያ | eCards', seoValD: 'የ{brand} {v} የስጦታ ካርድ በ{price}፣ {vat}% ተ.እ.ታን ጨምሮ። በM-Pesa ይክፈሉ፤ ኮድዎን በኤስኤምኤስ ወይም በኢሜይል ያግኙ። {avail}',
  availIn: 'አለ፣ ወዲያውኑ ይደርሳል።', availPreS: 'ቅድመ ትዕዛዝ፣ እስከ {date} ይጠበቃል።',
  seoHelpT: 'እገዛ፣ ጥያቄዎችና ፖሊሲዎች | eCards', seoHelpD: 'የስጦታ ካርዶችን በM-Pesa እንዴት እንደሚገዙ፣ በኤስኤምኤስ ወይም በኢሜይል ማድረስ፣ ቅድመ ትዕዛዝ፣ ገንዘብ ያለመመለስ ፖሊሲና የeCards ድጋፍን የማግኛ መንገዶች።',
  mdFacts: 'ዋና ዋና እውነታዎች', mdFact1: 'ዋጋዎች በኢትዮጵያ ብር (ETB) ናቸው፤ {vat}% ተ.እ.ታን ያካትታሉ። 1 የአሜሪካ ዶላር የካርድ መጠን = {rate} ብር።',
  mdFact2: 'ክፍያ፦ በM-Pesa ብቻ። ደንበኛው ክፍያውን በስልኩ በፒኑ ያጸድቃል።', mdFact3: 'ማድረሻ፦ ኮዱ በማያ ገጹና በ«የእኔ ትዕዛዞች» ይታያል፤ በኤስኤምኤስ ወይም በኢሜይል ብዙውን ጊዜ በሰከንዶች ውስጥ ይላካል። ያለቁ ካርዶችን በቅድመ ትዕዛዝ መግዛት ይቻላል።',
  mdFact4: 'ሁሉም ሽያጮች የመጨረሻ ናቸው፤ የስጦታ ካርድ ኮዶች ከደረሱ በኋላ ገንዘብ አይመለስም።', mdFact5: 'መደብሩ በእንግሊዝኛ፣ በአማርኛ፣ በአፋን ኦሮሞ፣ በሶማሊኛና በትግርኛ እንዲሁም በM-Pesa መተግበሪያ ውስጥ ይገኛል።',
  llmsSummary: 'eCards ዲጂታል የስጦታ ካርዶችን ለኢትዮጵያ ደንበኞች ይሸጣል። ዋጋዎች በብር {vat}% ተ.እ.ታን ጨምሮ ናቸው፤ ክፍያ በM-Pesa፣ ኮዶች በኤስኤምኤስ ወይም በኢሜይል ይደርሳሉ።',
  llmsIntro: 'እያንዳንዱ የስጦታ ካርድ ገጽ እያንዳንዱን የካርድ መጠን ከዋጋው፣ ከተ.እ.ታ መጠኑና ከመገኘቱ ጋር ይዘረዝራል።'
});
Object.assign(WEB_I18N.om, {
  catH: 'Kaardiiwwan kennaa {cat}', catIntro: 'Biraandota kaardii kennaa {cat} {n}, gatiin Birriin VAT dabalatee. M-Pesa’n kaffaliitii koodicha sekondii keessatti argadhu.',
  valName: 'Kaardii kennaa {brand} {v}', priceTblH: 'Gatii kaardii kennaa {brand} Birriin', thValue: 'Gatii kaardii', thPrice: 'Gatii (Birr)', thVat: 'VAT dabalame', thAvail: 'Argamuu', availInS: 'Ni jira',
  updated: 'Gatiin {date} haaromfame. Doolaara Ameerikaa 1 = Birr {rate}.',
  brandIntro: 'Kaardii kennaa {brand} Itoophiyaa keessatti bitadhuu Birriin M-Pesa’n kaffali. Kaardiiwwan {lo} hanga {hi} gatiin isaanii {plo} hanga {phi} yoo ta’u VAT {vat}% of keessaa qaba. Koodiin kee SMS ykn imeeliidhaan yeroo baay’ee sekondii keessatti si ga’a.',
  valIntro: 'Kaardiin kennaa {brand} {v} Itoophiyaa keessatti gatiin isaa {price} dha, VAT {vatAmt} dabalatee. Lakkoofsa moobaayilaa Itoophiyaa kamiin iyyuu M-Pesa’n kaffaliitii koodii kee SMS ykn imeeliidhaan argadhu.',
  bfaqH: 'Gaaffiiwwan kaardii kennaa {brand}',
  bq1: 'Kaardiin kennaa {brand} Itoophiyaa keessatti meeqa?', ba1: 'Kaardiin kennaa {brand} gatiin isaa {list} dha, VAT {vat}% dabalatee.',
  bq2: 'Koodii {brand} koo akkamittan argadha?', ba2: 'M-Pesa’n kaffali; koodiin battaluma iskiriinii irratti fi “Ajajawwan koo” keessatti mul’ata. SMS ykn imeeliidhaanis siif ergina. Kaardiiwwan dhuman akkuma galaniin ergamu.',
  bq3: 'Kaardii kennaa {brand} nama biraatiif erguu nan danda’aa?', ba3: 'Eeyyee. Yeroo kaffaltii SMS ykn imeelii filadhuutii lakkoofsa bilbilaa ykn imeelii isaanii galchi. Koodiin kallattiin isaan ga’a.',
  bq4: 'Koodii {brand} irratti maallaqni naa deebi’uu danda’aa?', ba4: 'Lakki. Koodiiwwan dijitaalaa erga ga’anii booda hin deebi’an, maallaqnis hin deebi’u. Koodiin yoo hin hojjenne deeggarsa eCards quunnami; ni gargaarra.',
  seoHomeT: 'Kaardiiwwan kennaa Itoophiyaa keessatti M-Pesa’n bitadhu | eCards', seoHomeD: 'Kaardiiwwan kennaa Netflix, PlayStation, Steam, Spotify fi kan biroo. Gatiin Birriin VAT dabalatee. M-Pesa’n kaffaliitii koodii kee sekondii keessatti SMS ykn imeeliidhaan argadhu.',
  seoAllT: 'Kaardiiwwan kennaa hunda Itoophiyaa keessatti, gatii Birriin | eCards', seoAllD: 'Biraandota kaardii kennaa {n} Itoophiyaa keessatti gurguraman wal bira qabi. Gatii Birriin VAT dabalatee ilaali, M-Pesa’n kaffali, SMS ykn imeeliidhaan battaluma argadhu.',
  seoCatT: 'Kaardiiwwan kennaa {cat} Itoophiyaa keessatti | eCards', seoCatD: 'Kaardiiwwan kennaa {cat} Itoophiyaa keessatti bitadhu: {brands}. Gatiin Birriin VAT dabalatee, M-Pesa’n kaffali, SMS ykn imeeliidhaan battaluma ga’a.',
  seoBrandT: 'Kaardii kennaa {brand} Itoophiyaa, {price} irraa | eCards', seoBrandD: 'Kaardii kennaa {brand} Itoophiyaa keessatti {price} irraa jalqabee bitadhu ({range}). M-Pesa’n kaffali, VAT dabalatee, koodiin sekondii keessatti SMS ykn imeeliidhaan ga’a.',
  seoValT: 'Kaardii kennaa {brand} {v}, {price} Itoophiyaa keessatti | eCards', seoValD: 'Kaardii kennaa {brand} {v} {price}tti, VAT {vat}% dabalatee. M-Pesa’n kaffaliitii koodii kee SMS ykn imeeliidhaan argadhu. {avail}',
  availIn: 'Ni jira, battaluma ga’a.', availPreS: 'Dursa ajaja, {date} dura ni eegama.',
  seoHelpT: 'Gargaarsa, gaaffiiwwan fi imaammata | eCards', seoHelpD: 'Akkaataa kaardiiwwan kennaa M-Pesa’n itti bitan, erguu SMS ykn imeeliin, dursa ajaja, imaammata maallaqni hin deebine fi deeggarsa eCards itti quunnaman.',
  mdFacts: 'Dhugaawwan ijoo', mdFact1: 'Gatiin Birr Itoophiyaatiin (ETB) yoo ta’u VAT {vat}% of keessaa qaba. Gatii kaardii doolaara Ameerikaa 1 = Birr {rate}.',
  mdFact2: 'Kaffaltii: M-Pesa qofa. Maamilli kaffaltii bilbila isaa irratti PIN isaatiin mirkaneessa.', mdFact3: 'Erguu: koodiin iskiriinii irratti fi “Ajajawwan koo” keessatti mul’ata; SMS ykn imeeliidhaan yeroo baay’ee sekondii keessatti ergama. Kaardiiwwan dhuman dursa ajajaan bitamuu danda’u.',
  mdFact4: 'Gurgurtaan hundi xumuraa dha: koodiiwwan kaardii kennaa erga ga’anii booda maallaqni hin deebi’u.', mdFact5: 'Suuqiin Afaan Ingiliffaa, Amaariffaa, Afaan Oromoo, Afaan Somaalee fi Tigriffaan, akkasumas appii M-Pesa keessatti ni argama.',
  llmsSummary: 'eCards kaardiiwwan kennaa dijitaalaa maamiltoota Itoophiyaatiif gurgura. Gatiin Birriin VAT {vat}% dabalatee, kaffaltiin M-Pesa’n, koodiiwwan SMS ykn imeeliidhaan ga’u.',
  llmsIntro: 'Fuulli kaardii kennaa tokkoon tokkoon gatii kaardii hunda gatii Birrii, VAT fi argamuu isaa wajjin tarreessa.'
});
Object.assign(WEB_I18N.so, {
  catH: 'Kaararka hadiyadda {cat}', catIntro: '{n} summadood oo kaararka hadiyadda {cat} ah, qiimahoodu waa Birr oo VAT ku jiro. Ku bixi M-Pesa oo koodka ku hel ilbiriqsiyo gudahood.',
  valName: 'Kaarka hadiyadda {brand} {v}', priceTblH: 'Qiimaha kaarka hadiyadda {brand} ee Birr', thValue: 'Qiimaha kaarka', thPrice: 'Qiimaha (Birr)', thVat: 'VAT ku jira', thAvail: 'Helitaanka', availInS: 'Waa diyaar',
  updated: 'Qiimaha waxaa la cusbooneysiiyay {date}. 1 doollar = Br {rate}.',
  brandIntro: 'Ka iibso kaarka hadiyadda {brand} Itoobiya oo ku bixi Birr adigoo isticmaalaya M-Pesa. Kaararka {lo} ilaa {hi} qiimahoodu waa {plo} ilaa {phi}, oo ay ku jirto VAT {vat}%. Koodkaaga waxaa lagu gaarsiiyaa SMS ama iimayl, badanaa ilbiriqsiyo gudahood.',
  valIntro: 'Kaarka hadiyadda {brand} {v} qiimihiisu waa {price} gudaha Itoobiya, oo ay ku jirto VAT {vatAmt}. Ku bixi M-Pesa lambar kasta oo mobayl Itoobiyaan ah oo koodkaaga ku hel SMS ama iimayl.',
  bfaqH: 'Su’aalaha kaarka hadiyadda {brand}',
  bq1: 'Imisa ayuu yahay kaarka hadiyadda {brand} gudaha Itoobiya?', ba1: 'Kaarka hadiyadda {brand} qiimihiisu waa {list}, oo ay ku jirto VAT {vat}%.',
  bq2: 'Sideen u helaa koodkayga {brand}?', ba2: 'Ku bixi M-Pesa koodkuna isla markiiba wuxuu ka muuqdaa shaashadda iyo “Dalabaadkayga”. Waxaan sidoo kale kuugu soo dirnaa SMS ama iimayl. Kaararka dhammaaday waxaa la diraa isla marka ay yimaadaan.',
  bq3: 'Ma u diri karaa kaarka hadiyadda {brand} qof kale?', ba3: 'Haa. Marka aad bixinayso dooro SMS ama iimayl oo geli lambarkooda ama iimaylkooda. Koodka si toos ah ayay u helayaan.',
  bq4: 'Lacagta ma la ii celin karaa kood {brand} ah?', ba4: 'Maya. Koodadka dhijitaalka ah lama celin karo lacagtana lama celiyo marka la gaarsiiyo. Haddii kood uusan shaqeyn, la xiriir taageerada eCards waan ku caawin doonaa.',
  seoHomeT: 'Ka iibso kaararka hadiyadda Itoobiya M-Pesa | eCards', seoHomeD: 'Kaararka hadiyadda Netflix, PlayStation, Steam, Spotify iyo kuwo kale gudaha Itoobiya. Qiimaha Birr oo VAT ku jiro. Ku bixi M-Pesa oo koodkaaga ku hel SMS ama iimayl ilbiriqsiyo gudahood.',
  seoAllT: 'Dhammaan kaararka hadiyadda Itoobiya, qiimaha Birr | eCards', seoAllD: 'Isbarbardhig {n} summadood oo kaararka hadiyadda ah oo laga iibiyo Itoobiya. Eeg qiimaha Birr oo VAT ku jiro, ku bixi M-Pesa oo hel gaarsiin degdeg ah SMS ama iimayl.',
  seoCatT: 'Kaararka hadiyadda {cat} ee Itoobiya | eCards', seoCatD: 'Ka iibso kaararka hadiyadda {cat} Itoobiya: {brands}. Qiimaha Birr oo VAT ku jiro, ku bixi M-Pesa, gaarsiin degdeg ah SMS ama iimayl.',
  seoBrandT: 'Kaarka hadiyadda {brand} Itoobiya, laga bilaabo {price} | eCards', seoBrandD: 'Ka iibso kaarka hadiyadda {brand} Itoobiya laga bilaabo {price} ({range}). Ku bixi M-Pesa, VAT ku jiro, koodka waxaa lagu gaarsiiyaa SMS ama iimayl ilbiriqsiyo gudahood.',
  seoValT: 'Kaarka hadiyadda {brand} {v}, {price} Itoobiya | eCards', seoValD: 'Kaarka hadiyadda {brand} {v} oo ah {price} oo ay ku jirto VAT {vat}%. Ku bixi M-Pesa oo koodkaaga ku hel SMS ama iimayl. {avail}',
  availIn: 'Waa diyaar, gaarsiin degdeg ah.', availPreS: 'Dalab hore, waxaa la filayaa {date}.',
  seoHelpT: 'Caawimaad, su’aalo iyo siyaasado | eCards', seoHelpD: 'Sida loogu iibsado kaararka hadiyadda M-Pesa, gaarsiinta SMS ama iimayl, dalabka hore, siyaasadda lacag-celin la’aanta iyo sida loola xiriiro taageerada eCards.',
  mdFacts: 'Xaqiiqooyinka muhiimka ah', mdFact1: 'Qiimuhu waa Birr Itoobiyaan (ETB) waxaana ku jira VAT {vat}%. 1 doollar oo qiimaha kaarka ah = Br {rate}.',
  mdFact2: 'Lacag bixin: M-Pesa oo kaliya. Macmiilku wuxuu ku ansixiyaa lacag bixinta taleefankiisa isagoo isticmaalaya PIN-kiisa.', mdFact3: 'Gaarsiin: koodka wuxuu ka muuqdaa shaashadda iyo “Dalabaadkayga”, waxaana lagu diraa SMS ama iimayl, badanaa ilbiriqsiyo gudahood. Kaararka dhammaaday dalab hore ayaa lagu iibsan karaa.',
  mdFact4: 'Dhammaan iibku waa kama dambays: koodadka kaararka hadiyadda lacagtooda lama celiyo marka la gaarsiiyo.', mdFact5: 'Dukaanku wuxuu ku jiraa Ingiriis, Amxaari, Afaan Oromo, Soomaali iyo Tigrinya, iyo sidoo kale abka M-Pesa.',
  llmsSummary: 'eCards waxay macaamiisha Itoobiya u iibisaa kaararka hadiyadda dhijitaalka ah. Qiimuhu waa Birr oo VAT {vat}% ku jiro, lacag bixintu waa M-Pesa, koodadkana waxaa lagu gaarsiiyaa SMS ama iimayl.',
  llmsIntro: 'Bog kasta oo kaar hadiyadeed wuxuu taxaa qiime kasta oo kaarka ah iyo qiimihiisa Birr, VAT-ka iyo haddii uu diyaar yahay.'
});
Object.assign(WEB_I18N.ti, {
  catH: 'ናይ {cat} ህያብ ካርድታት', catIntro: '{n} ብራንድታት ናይ {cat} ህያብ ካርድ፣ ዋጋኦም ብብር ተ.እ.ታ ሓዊሱ። ብM-Pesa ክፈል፣ ነቲ ኮድ ኣብ ሒደት ካልኢታት ርኸብ።',
  valName: 'ናይ {brand} {v} ህያብ ካርድ', priceTblH: 'ዋጋታት ናይ {brand} ህያብ ካርድ ብብር', thValue: 'መጠን ካርድ', thPrice: 'ዋጋ (ብር)', thVat: 'ዝተሓወሰ ተ.እ.ታ', thAvail: 'ምርካብ', availInS: 'ኣሎ',
  updated: 'ዋጋታት {date} ተሓዲሶም። 1 ዶላር ኣሜሪካ = {rate} ብር።',
  brandIntro: 'ናይ {brand} ህያብ ካርድ ኣብ ኢትዮጵያ ዕደግ፣ ብብር ብM-Pesa ክፈል። ካብ {lo} ክሳዕ {hi} ዘለዉ ካርድታት ዋጋኦም ካብ {plo} ክሳዕ {phi} ኮይኑ {vat}% ተ.እ.ታ ሓዊሱ። ኮድካ ብኤስኤምኤስ ወይ ብኢመይል መብዛሕትኡ ግዜ ኣብ ሒደት ካልኢታት ይበጽሕ።',
  valIntro: 'ናይ {brand} {v} ህያብ ካርድ ኣብ ኢትዮጵያ ዋጋኡ {price} እዩ፣ {vatAmt} ተ.እ.ታ ሓዊሱ። ካብ ዝኾነ ቁጽሪ ሞባይል ኢትዮጵያ ብM-Pesa ክፈል፣ ኮድካ ብኤስኤምኤስ ወይ ብኢመይል ርኸብ።',
  bfaqH: 'ሕቶታት ብዛዕባ ናይ {brand} ህያብ ካርድ',
  bq1: 'ናይ {brand} ህያብ ካርድ ኣብ ኢትዮጵያ ክንደይ እዩ?', ba1: 'ናይ {brand} ህያብ ካርድ ዋጋኡ {list} እዩ፣ {vat}% ተ.እ.ታ ሓዊሱ።',
  bq2: 'ኮድ {brand} ብኸመይ እረኽቦ?', ba2: 'ብM-Pesa ክፈል፣ እቲ ኮድ ብቕጽበት ኣብ ስክሪንን ኣብ «ትእዛዛተይ»ን ይርአ። ብኤስኤምኤስ ወይ ብኢመይል’ውን ንሰደልካ። ዝተወድኡ ካርድታት ምስ ኣተዉ ይስደዱ።',
  bq3: 'ናይ {brand} ህያብ ካርድ ንካልእ ሰብ ክሰድድ እኽእልዶ?', ba3: 'እወ። ኣብ ግዜ ክፍሊት ኤስኤምኤስ ወይ ኢመይል ምረጽ እሞ ቁጽሪ ስልኪ ወይ ኢመይል ናይቲ ሰብ ኣእቱ። እቲ ኮድ ብቐጥታ ይበጽሖም።',
  bq4: 'ንኮድ {brand} ገንዘበይ ክምለሰለይ ይኽእልዶ?', ba4: 'ኣይፋል። ዲጂታላዊ ኮዳት ድሕሪ ምብጻሖም ኣይምለሱን ገንዘብ’ውን ኣይምለስን። ኮድ እንተዘይሰሪሑ ደገፍ eCards ርኸቡ፣ ክንሕግዘኩም ኢና።',
  seoHomeT: 'ኣብ ኢትዮጵያ ናይ ህያብ ካርድታት ብM-Pesa ዕደግ | eCards', seoHomeD: 'Netflix፣ PlayStation፣ Steam፣ Spotify ከምኡውን ካልኦት ናይ ህያብ ካርድታት ኣብ ኢትዮጵያ። ዋጋ ብብር ተ.እ.ታ ሓዊሱ። ብM-Pesa ክፈል፣ ኮድካ ኣብ ሒደት ካልኢታት ብኤስኤምኤስ ወይ ብኢመይል ርኸብ።',
  seoAllT: 'ኩሎም ናይ ህያብ ካርድታት ኣብ ኢትዮጵያ፣ ዋጋ ብብር | eCards', seoAllD: 'ኣብ ኢትዮጵያ ዝሽየጡ {n} ብራንድታት ናይ ህያብ ካርድ ኣወዳድር። ዋጋታት ብብር ተ.እ.ታ ሓዊሱ ርአ፣ ብM-Pesa ክፈል፣ ብኤስኤምኤስ ወይ ብኢመይል ብቕጽበት ርኸብ።',
  seoCatT: 'ናይ {cat} ህያብ ካርድታት ኣብ ኢትዮጵያ | eCards', seoCatD: 'ናይ {cat} ህያብ ካርድታት ኣብ ኢትዮጵያ ዕደግ፦ {brands}። ዋጋ ብብር ተ.እ.ታ ሓዊሱ፣ ብM-Pesa ክፈል፣ ብኤስኤምኤስ ወይ ብኢመይል ብቕጽበት ይበጽሕ።',
  seoBrandT: 'ናይ {brand} ህያብ ካርድ ኢትዮጵያ፣ ካብ {price} | eCards', seoBrandD: 'ናይ {brand} ህያብ ካርድ ኣብ ኢትዮጵያ ካብ {price} ጀሚሩ ዕደግ ({range})። ብM-Pesa ክፈል፣ ተ.እ.ታ ሓዊሱ፣ ኮድ ኣብ ሒደት ካልኢታት ብኤስኤምኤስ ወይ ብኢመይል ይበጽሕ።',
  seoValT: 'ናይ {brand} {v} ህያብ ካርድ፣ {price} ኣብ ኢትዮጵያ | eCards', seoValD: 'ናይ {brand} {v} ህያብ ካርድ ብ{price}፣ {vat}% ተ.እ.ታ ሓዊሱ። ብM-Pesa ክፈል፣ ኮድካ ብኤስኤምኤስ ወይ ብኢመይል ርኸብ። {avail}',
  availIn: 'ኣሎ፣ ብቕጽበት ይበጽሕ።', availPreS: 'ቅድሚ ትእዛዝ፣ ክሳዕ {date} ይጽበ።',
  seoHelpT: 'ሓገዝ፣ ሕቶታትን ፖሊሲታትን | eCards', seoHelpD: 'ናይ ህያብ ካርድታት ብM-Pesa ብኸመይ ከም ዝዕደጉ፣ ብኤስኤምኤስ ወይ ብኢመይል ምብጻሕ፣ ቅድሚ ትእዛዝ፣ ፖሊሲ ዘይምምላስ ገንዘብን ደገፍ eCards ብኸመይ ከም ዝርከብን።',
  mdFacts: 'ቀንዲ ሓቅታት', mdFact1: 'ዋጋታት ብብር ኢትዮጵያ (ETB) እዮም፣ {vat}% ተ.እ.ታ ሓዊሶም። 1 ዶላር ኣሜሪካ መጠን ካርድ = {rate} ብር።',
  mdFact2: 'ክፍሊት፦ ብM-Pesa ጥራይ። ዓሚል ነቲ ክፍሊት ኣብ ስልኩ ብፒኑ የጽድቖ።', mdFact3: 'ምብጻሕ፦ እቲ ኮድ ኣብ ስክሪንን ኣብ «ትእዛዛተይ»ን ይርአ፣ ብኤስኤምኤስ ወይ ብኢመይል መብዛሕትኡ ግዜ ኣብ ሒደት ካልኢታት ይስደድ። ዝተወድኡ ካርድታት ብቅድሚ ትእዛዝ ክዕደጉ ይኽእሉ።',
  mdFact4: 'ኩሉ መሸጣ ናይ መወዳእታ እዩ፦ ኮዳት ናይ ህያብ ካርድ ድሕሪ ምብጻሖም ገንዘብ ኣይምለስን።', mdFact5: 'እቲ ድኳን ብእንግሊዝኛ፣ ብኣምሓርኛ፣ ብኦሮምኛ፣ ብሶማልኛን ብትግርኛን፣ ከምኡውን ኣብ ውሽጢ ኣፕ M-Pesa ይርከብ።',
  llmsSummary: 'eCards ዲጂታላዊ ናይ ህያብ ካርድታት ንዓማዊል ኢትዮጵያ ይሸይጥ። ዋጋታት ብብር {vat}% ተ.እ.ታ ሓዊሱ፣ ክፍሊት ብM-Pesa፣ ኮዳት ብኤስኤምኤስ ወይ ብኢመይል ይበጽሑ።',
  llmsIntro: 'ነፍሲ ወከፍ ገጽ ህያብ ካርድ ነፍሲ ወከፍ መጠን ካርድ ምስ ዋጋኡ ብብር፣ ተ.እ.ታን ምርካቡን ይዝርዝር።'
});


/* ================= web store ================= */
const K_WEB_SESSION = 'ecards-web-session', K_WEB_CART = 'ecards-web-cart', K_WEB_USERS = 'ecards-web-users';
const K_LANG = 'ecards-et-demo-ui-lang';   // shared with the mini app, so both open in the same language
const LINKED = /^(https?|file):$/.test(location.protocol);   // a real page, not a preview window
const metaContent = n => { const m = document.querySelector(`meta[name="${n}"]`); return m ? m.getAttribute('content') : null; };
/* the public address of the store: the site build writes it into <meta name="ec-site">; change it in site.config.json */
const SITE_URL = (metaContent('ec-site') || 'https://ecards.example.com').replace(/\/+$/, '');
/* clean addresses (/am/netflix-gift-card/50-usd/) on a web server; #/… addresses when opened as a file or in a preview */
const PATH_MODE = /^https?:$/.test(location.protocol) && !metaContent('ec-hash');
Object.assign(P, {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4 20.5c1-4 4.2-6 8-6s7 2 8 6"/>',
  shield: '<path d="M12 3.5l7.5 3v5.6c0 4.4-3.2 7.6-7.5 8.9-4.3-1.3-7.5-4.5-7.5-8.9V6.5z"/><path d="M8.8 12.2l2.3 2.3 4.3-4.6"/>',
  receipt: '<path d="M6 3.5h12v17l-2.5-1.6L13 20.5l-2.5-1.6L8 20.5l-2-1.3z"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/>',
  tg: '<path d="M21 4.5L3.5 11.2l5.6 2 2.1 6.3 3.2-3.7 4.7 3.5z"/><path d="M9.1 13.2l8.4-6"/>'
});

/* ---------- languages: English, Amharic, Afaan Oromo, Somali, Tigrinya ---------- */
const LANGS = [
  { code: 'en', native: 'English', en: 'English', locale: 'en_US' }, { code: 'am', native: 'አማርኛ', en: 'Amharic', locale: 'am_ET' },
  { code: 'om', native: 'Afaan Oromoo', en: 'Afaan Oromo', locale: 'om_ET' }, { code: 'so', native: 'Soomaali', en: 'Somali', locale: 'so_ET' },
  { code: 'ti', native: 'ትግርኛ', en: 'Tigrinya', locale: 'ti_ET' }
];
const LCODES = LANGS.map(l => l.code);
let lang = (() => {
  const saved = store.get(K_LANG, null);
  if (saved && WEB_I18N[saved]) return saved;
  const prefs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']).map(x => String(x).slice(0, 2).toLowerCase());
  return prefs.find(c => WEB_I18N[c]) || 'en';
})();
function tl(l, key, vars) {
  let v = (WEB_I18N[l] && WEB_I18N[l][key] !== undefined) ? WEB_I18N[l][key] : WEB_I18N.en[key];
  if (v === undefined) return key;
  if (vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return v.replace(/M-Pesa/g, 'M‑Pesa');   // keep "M-Pesa" on one line
}
const t = (key, vars) => tl(lang, key, vars);
const te = (k, vars) => esc(t(k, vars));                                  // text
function th(k, vars) {                                                    // text with ready-made HTML pieces in its placeholders
  return t(k).split(/(\{\w+\})/).map(p => { const m = p.match(/^\{(\w+)\}$/); return m && vars[m[1]] !== undefined ? vars[m[1]] : esc(p); }).join('');
}
const catNameL = (l, c) => { const k = 'cat_' + c; const v = tl(l, k); return v !== k ? v : c; };
const catName = c => catNameL(lang, c);

/* ---------- addresses: one per page and language, so search engines can index every page ---------- */
const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'card';
const CAT_SLUG = { gaming: 'gaming', video: 'streaming', music: 'music', apps: 'apps', telecom: 'mobile-top-up', card: 'other' };
const brandSlug = b => slugify(b.name);
const brandBySlug = s => BRANDS.find(b => !b.hidden && brandSlug(b) === s);
function pathOf(p, q = '', o = {}) {
  const l = o.lang || lang, pre = l === 'en' ? '/' : `/${l}/`;
  if (p === 'all') return pre + 'gift-cards/' + (q && CAT_SLUG[q] ? CAT_SLUG[q] + '/' : '');
  if (p === 'brand' && BR[q]) return pre + brandSlug(BR[q]) + '-gift-card/' + (o.v ? `${o.v}-usd/` : '');
  if (p === 'cart' || p === 'orders' || p === 'help') return pre + p + '/';
  return pre;
}
const urlOf = (p, q, o) => SITE_URL + pathOf(p, q, o);
const hrefOf = (p, q, o = {}) => (PATH_MODE ? pathOf(p, q, o) : '#' + pathOf(p, q, o)) + (o.hash && PATH_MODE ? '#' + o.hash : '');
function parsePath(path) {
  const parts = String(path || '/').split(/[?#]/)[0].split('/').filter(Boolean);
  let l = 'en';
  if (parts.length && LCODES.includes(parts[0]) && parts[0] !== 'en') l = parts.shift();
  const r = { lang: l, p: 'home', q: '', v: null };
  if (!parts.length) return r;
  if (parts[0] === 'gift-cards') { r.p = 'all'; const c = Object.keys(CAT_SLUG).find(k => CAT_SLUG[k] === parts[1]); r.q = c || ''; return r; }
  if (['cart', 'orders', 'help'].includes(parts[0])) { r.p = parts[0]; return r; }
  const m = parts[0].match(/^(.+)-gift-card$/), b = m && brandBySlug(m[1]);
  if (b) { r.p = 'brand'; r.q = b.id; const vm = parts[1] && parts[1].match(/^(\d+)-usd$/); if (vm) r.v = +vm[1]; return r; }
  r.p = 'notfound'; return r;
}
/* A link that works with and without JavaScript: a real address for search engines, handled in the page when clicked */
const A = (p, q, cls, inner, o = {}) => `<a class="${cls}" href="${hrefOf(p, q, o)}" data-go="${p}"${q ? ` data-q="${esc(q)}"` : ''}${o.v ? ` data-v="${o.v}"` : ''}${o.hash ? ` data-hash="${o.hash}"` : ''}${o.lang ? ` data-lang-to="${o.lang}"` : ''}${o.attrs || ''}>${inner}</a>`;

const isoNow = new Date();
const live = b => b && !b.hidden && !b.off;
const liveBrands = () => BRANDS.filter(live);
const cardName = (bid, v) => `${BR[bid].name} ${usd(v)}`;
const vatOf = gross => gross * VAT / (1 + VAT);
const initialsOf = n => String(n || '').split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'E';
const maskCode = c => String(c).replace(/[A-Z0-9](?=[A-Z0-9-]*-[A-Z0-9]{4}$)/g, '•');
const saveCart = () => { store.set(K_WEB_CART, cart); drawHeader(); };
const cartCount = () => cart.reduce((x, it) => x + it.qty, 0);
const cartTotal = () => cart.reduce((x, it) => x + priceOf(it.amount) * it.qty, 0);
const fmtWhen = ts => new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const isoDate = ts => new Date(ts).toISOString().slice(0, 10);
function normPhone(v) {   // Ethiopian mobile: 07… (Safaricom) or 09… (Ethio telecom), with or without +251
  let d = String(v).replace(/\D/g, '');
  if (d.startsWith('251')) d = d.slice(3); else if (d.startsWith('0')) d = d.slice(1);
  return /^[79]\d{8}$/.test(d) ? `+251 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : null;
}
const stripCC = p => String(p || '').replace(/^\+251\s?/, '');
const myOrders = () => session ? allOrders.filter(o => o.phone === session.phone).sort((a, b) => b.at - a.at) : [];
const ui = { cat: 'all', q: '', sort: 'popular', pv: {}, qty: 1, rev: new Set(), menu: false, langMenu: false };
const cardsN = n => n === 1 ? t('cards1') : t('cardsN', { n });

/* ---------- toast ---------- */
let toastT = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3200);
}

/* ---------- availability ---------- */
function availOf(bid, v) {   // 'ok' | 'low' | 'pre'
  if (isOut(bid, v)) return 'pre';
  return isLow(bid, v) ? 'low' : 'ok';
}
const brandAvail = b => b.amounts.some(v => !isOut(b.id, v)) ? 'ok' : 'pre';

/* ---------- routing ---------- */
let route = { p: 'home', q: '', v: null };
function readLocation() {
  const pre = metaContent('ec-route');   // pre-rendered pages say which page they are, even when opened as a file
  const hashPath = location.hash.startsWith('#/') ? location.hash.slice(1) : null;
  const r = parsePath(PATH_MODE ? location.pathname : (hashPath || pre || '/'));
  if (PATH_MODE) { const q = new URLSearchParams(location.search).get('q'); if (q && r.p === 'all') ui.q = q; }
  return r;
}
function applyRoute(r) {
  route = { p: r.p, q: r.q, v: r.v };
  if (r.lang !== lang) { lang = r.lang; document.documentElement.lang = lang; }
  if (route.p === 'all') ui.cat = route.q || 'all';
  if (route.p === 'brand' && !live(BR[route.q])) route = { p: 'notfound', q: '', v: null };
}
function go(p, q = '', opts = {}) {
  const l = opts.lang || lang;
  applyRoute({ p, q, v: opts.v || null, lang: l });
  if (l !== store.get(K_LANG, null)) store.set(K_LANG, l);
  if (p === 'brand' && !opts.keepScroll) ui.qty = 1;
  ui.menu = false; ui.langMenu = false;
  render(); drawFooter();
  const url = (PATH_MODE ? pathOf(route.p === 'notfound' ? 'home' : p, q, { v: opts.v, lang: l }) + (p === 'all' && ui.q ? '?q=' + encodeURIComponent(ui.q) : '') : '#' + pathOf(p, q, { v: opts.v, lang: l }));
  if (LINKED) { try { history[opts.replace ? 'replaceState' : 'pushState'](null, '', url); } catch (e) { /* preview window */ } }
  if (opts.scroll) { const el = document.getElementById(opts.scroll); if (el) el.scrollIntoView({ behavior: 'smooth' }); }
  else if (!opts.keepScroll) window.scrollTo(0, 0);
  if (!opts.keepFocus) { const m = document.getElementById('main'); m.focus({ preventScroll: true }); }
}
window.addEventListener('popstate', () => { applyRoute(readLocation()); render(); drawFooter(); });
function setLang(code) {
  if (!WEB_I18N[code] || code === lang) return;
  store.set(K_LANG, code);
  go(route.p === 'notfound' ? 'home' : route.p, route.q, { v: route.v, lang: code, keepScroll: true, replace: false, keepFocus: true });
}

/* ---------- header and footer ---------- */
const langMenuHTML = () => `<div class="menu lmenu" role="menu" aria-label="${te('language')}">${LANGS.map(l => A(route.p === 'notfound' ? 'home' : route.p, route.q, '', `<span>${esc(l.native)}</span>${l.code !== 'en' ? `<small lang="en">${esc(l.en)}</small>` : ''}${l.code === lang ? ic('check') : ''}`, { v: route.v, lang: l.code, attrs: ` role="menuitemradio" aria-checked="${l.code === lang}" hreflang="${l.code}" lang="${l.code}"` })).join('')}</div>`;
function drawHeader() {
  const n = cartCount(), cur = route.p;
  const navA = (p, label, o = {}) => A(p, '', '', label, { ...o, attrs: cur === p && !o.hash ? ' aria-current="page"' : '' });
  const L = LANGS.find(l => l.code === lang);
  document.getElementById('top').innerHTML = `<div class="wrap top-in">
    ${A('home', '', 'logo', `${ecLogo()}<b>eCards</b>`, { attrs: ` aria-label="${te('homeAria')}"` })}
    <nav class="nav" aria-label="${te('mainNav')}">${navA('all', te('navGift'))}${navA('home', te('navHow'), { hash: 'how' })}${navA('help', te('navHelp'))}</nav>
    <form class="hsearch top-s" role="search" action="${PATH_MODE ? pathOf('all') : '#'}" data-search>${ic('search')}<label class="sr" for="hq">${te('searchLbl')}</label><input id="hq" name="q" type="search" placeholder="${te('searchPh')}" autocomplete="off" value="${esc(ui.q)}"></form>
    <div class="tacts">
      ${A('all', '', 'circ m-only', ic('search'), { attrs: ` data-focus="cq" aria-label="${te('search')}"` })}
      <div class="acct-wrap"><button class="tbtn" data-act="lang" aria-expanded="${ui.langMenu}" aria-haspopup="true" aria-label="${te('language')}: ${esc(L.native)}">${ic('globe')}<span class="t-txt l-txt">${esc(L.native)}</span></button>${ui.langMenu ? langMenuHTML() : ''}</div>
      ${A('orders', '', 'tbtn', `${ic('receipt')}<span class="t-txt">${te('myOrders')}</span>`, { attrs: ' rel="nofollow"' })}
      ${session ? `<div class="acct-wrap"><button class="tbtn" data-act="menu" aria-expanded="${ui.menu}" aria-haspopup="true"><span class="avatar">${esc(initialsOf(session.name))}</span><span class="t-txt">${esc(session.name.split(' ')[0])}</span></button>
        ${ui.menu ? `<div class="menu" role="menu"><div class="who"><b>${esc(session.name)}</b><small>${esc(session.phone)}</small></div>
          ${A('orders', '', '', `${ic('receipt')}${te('myOrders')}`, { attrs: ' role="menuitem"' })}${A('help', '', '', `${ic('chat')}${te('helpContact')}`, { attrs: ' role="menuitem"' })}<button role="menuitem" data-act="signout">${ic('logout')}${te('signOut')}</button></div>` : ''}</div>`
      : `<button class="tbtn" data-act="signin">${ic('user')}<span class="t-txt">${te('signIn')}</span></button>`}
      ${A('cart', '', 'circ', `${ic('cart')}${n ? `<span class="badge">${n}</span>` : ''}`, { attrs: ` rel="nofollow" aria-label="${te('cartAria', { n })}"` })}
    </div>
  </div>`;
}
const ecLogo = () => `<span class="ec">${HAVE.logos.ecards ? `<img src="${esc(HAVE.logos.ecards)}" alt="" width="42" height="42">` : '<span>eCards</span>'}</span>`;
function drawFooter() {
  const sp = cfg.support;
  const cats = [...new Set(liveBrands().map(b => b.cat))];
  document.getElementById('foot').innerHTML = `<div class="wrap foot-in">
    <div><span class="logo">${ecLogo()}<b>eCards</b></span><p>${te('footBlurb')}</p>
      <nav class="flangs" aria-label="${te('language')}">${ic('globe')}${LANGS.map(l => A(route.p === 'notfound' ? 'home' : route.p, route.q, l.code === lang ? 'on' : '', esc(l.native), { v: route.v, lang: l.code, attrs: ` hreflang="${l.code}" lang="${l.code}"${l.code === lang ? ' aria-current="true"' : ''}` })).join('')}</nav></div>
    <div><h2>${te('shop')}</h2><ul><li>${A('all', '', '', te('allCards'))}</li>${cats.map(c => `<li>${A('all', c, '', esc(catName(c)))}</li>`).join('')}</ul></div>
    <div><h2>${te('giftCards')}</h2><ul>${popularOrder().slice(0, 6).map(b => `<li>${A('brand', b.id, '', te('cardTitle', { name: b.name }))}</li>`).join('')}</ul></div>
    <div><h2>${te('navHelp')}</h2><ul><li>${A('home', '', '', te('navHow'), { hash: 'how' })}</li><li>${A('help', '', '', te('qa'))}</li><li>${A('help', '', '', te('contactUs'), { hash: 'contact' })}</li><li>${A('help', '', '', te('terms'), { hash: 'terms' })}</li><li>${A('help', '', '', te('privacy'), { hash: 'privacy' })}</li><li>${A('help', '', '', te('norefund'), { hash: 'refunds' })}</li></ul></div>
  </div>
  <div class="wrap foot-bot"><span>© ${isoNow.getFullYear()} eCards · ${te('footPrices')}${sp.from && sp.to ? ` · ${te('everyDay', { from: sp.from, to: sp.to })}` : ''}</span><span>${te('footDemo')}</span></div>`;
}

/* ---------- pieces ---------- */
const btile = b => A('brand', b.id, 'btile', `${tile(b)}<span class="tlabel">${esc(b.label || b.name)}</span>`);
const preTag = () => `<span class="st pre">${ic('clock')}${te('preorder')}</span>`;
const instTag = () => `<span class="st ok">${ic('check')}${te('instant')}</span>`;
function bcard(b, hTag = 'h3') {
  const lo = Math.min(...b.amounts), hi = Math.max(...b.amounts), a = brandAvail(b);
  return A('brand', b.id, 'bcard', `
    ${pkg(b.id, lo, 'ETH', true, a === 'pre')}
    <${hTag} class="nm">${te('cardTitle', { name: b.name })}</${hTag}><span class="vals">${b.amounts.length > 1 ? `${usd(lo)} – ${usd(hi)}` : usd(lo)} · ${esc(catName(b.cat))}</span>
    <span class="row"><span class="pr"><small>${te('from')}</small>${fmt(priceOf(lo))}</span>${a === 'pre' ? preTag() : instTag()}</span>`);
}
const popularOrder = () => [...POPULAR.filter(id => live(BR[id])), ...liveBrands().map(b => b.id).filter(id => !POPULAR.includes(id))].map(id => BR[id]);
function wallHTML(pal, seed) {
  const rnd = mulberry32(seed); let s = '';
  for (let i = 0; i < 64; i++) {
    const a = pal[Math.floor(rnd() * pal.length)], b = pal[Math.floor(rnd() * pal.length)];
    const ang = Math.floor(rnd() * 360), x = Math.floor(rnd() * 100), y = Math.floor(rnd() * 100);
    const r = rnd(), k = r < .34 ? 'k1' : r < .6 ? 'k2' : '';
    s += `<i class="${k}" style="background:radial-gradient(circle at ${x}% ${y}%,rgba(255,255,255,.28),transparent 52%),linear-gradient(${ang}deg,${a},${b})"></i>`;
  }
  return `<div class="wall" aria-hidden="true">${s}</div>`;
}
const ART = [['playstation', 22, 18, 30], ['netflix', 72, 14, 27], ['xbox', 48, 46, 36], ['spotify', 86, 52, 28], ['apple', 14, 62, 26], ['steam', 64, 82, 26], ['razer', 30, 90, 22]];
const catChips = cats => `<div class="chips" role="group" aria-label="${te('category')}">${cats.map(c => `<button class="fchip" data-cat="${c}" aria-pressed="${ui.cat === c}">${c === 'all' ? te('catAll') : esc(catName(c))}</button>`).join('')}</div>`;
const catLinks = cats => `<nav class="chips" aria-label="${te('category')}">${cats.map(c => A('all', c === 'all' ? '' : c, 'fchip', c === 'all' ? te('catAll') : esc(catName(c)), { attrs: (route.q || 'all') === c ? ' aria-current="page"' : '' })).join('')}</nav>`;
const updatedLine = () => `<p class="updated">${ic('clock')}${te('updated', { date: dmy(Date.now()), rate: num(RATE) })}</p>`;
const num = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/* ---------- pages ---------- */
function Home() {
  const cats = ['all', ...new Set(liveBrands().map(b => b.cat))];
  if (!cats.includes(ui.cat)) ui.cat = 'all';
  const list = popularOrder().filter(b => ui.cat === 'all' || b.cat === ui.cat);
  const art = ART.filter(([id]) => live(BR[id])), sp = cfg.support;
  return `<section class="hero"><div class="wrap hero-in">
      <div>
        <span class="eyebrow">${BOLT}${te('eyebrow')}</span>
        <h1>${te('heroH')}</h1>
        <p class="lead">${te('heroP')}</p>
        <div class="hero-btns">${A('all', '', 'btn lg', `${te('browse')} ${ic('chevR')}`)}${A('home', '', 'btn line lg', te('navHow'), { hash: 'how' })}</div>
        <ul class="points"><li>${ic('check')}${te('pt1')}</li><li>${ic('check')}${te('pt2')}</li><li>${ic('check')}${te('pt3')}</li></ul>
      </div>
      <div class="hero-art" aria-hidden="true"><div class="dots"></div>${art.map(([id, x, y, w], i) => `<div class="fl" style="left:${x}%;top:${y}%;width:${w}cqw;--i:${i};--d:${(i % 5) * -0.7}s">${pkg(id, [100, 50, 200, 150][i % 4], 'ETH')}</div>`).join('')}</div>
    </div></section>
    <section class="wrap sec"><div class="sec-h"><h2>${te('popular')}</h2>${A('all', '', 'lnk', te('seeAll'))}</div>
      <div class="brands">${popularOrder().slice(0, 10).map(btile).join('')}</div></section>
    ${SLIDES.length ? `<section class="wrap sec"><div class="feat">${SLIDES.slice(0, 3).map(s => A('brand', s.bid, 'fbanner', `${HAVE.banners[s.bid] ? `<img class="photo" src="${esc(HAVE.banners[s.bid])}" alt="" loading="lazy">` : wallHTML(s.pal, wallSeed(s.bid))}<span class="shade"></span><span class="fc"><b>${esc(s.title)}</b><span>${te('shopBrand', { brand: BR[s.bid].label || BR[s.bid].name })} ${ic('chevR')}</span></span>`, { attrs: ` style="--accent:${s.accent}"` })).join('')}</div></section>` : ''}
    <section class="wrap sec"><div class="sec-h"><h2>${te('giftCards')}</h2><div style="margin-left:auto">${catChips(cats)}</div></div>
      <div class="grid">${list.map(b => bcard(b)).join('')}</div></section>
    <section class="how" id="how"><div class="wrap"><div class="sec-h"><h2>${te('navHow')}</h2><p>${te('howSub')}</p></div>
      <ol class="steps">
        <li><span class="sic">${ic('card')}</span><h3>${te('s1h')}</h3><p>${te('s1p', { vat: vatPct() })}</p></li>
        <li><span class="sic">${ic('phone')}</span><h3>${te('s2h')}</h3><p>${te('s2p')}</p></li>
        <li><span class="sic">${ic('mail')}</span><h3>${te('s3h')}</h3><p>${te('s3p')}</p></li>
      </ol></div></section>
    <section class="wrap trust">
      <div>${ic('send')}<span><b>${te('tr1h')}</b><small>${te('tr1p')}</small></span></div>
      <div>${ic('shield')}<span><b>${te('tr2h')}</b><small>${te('tr2p')}</small></span></div>
      <div>${ic('receipt')}<span><b>${te('tr3h')}</b><small>${te('tr3p')}</small></span></div>
      <div>${ic('chat')}<span><b>${te('tr4h')}</b><small>${sp.from && sp.to ? te('tr4p', { from: sp.from, to: sp.to }) : te('tr4p0')}</small></span></div>
    </section>`;
}
function catalogList() {
  const q = ui.q.trim().toLowerCase();
  let list = popularOrder().filter(b => (ui.cat === 'all' || b.cat === ui.cat) && (!q || `${b.name} ${b.label || ''} ${catName(b.cat)} ${WEB_I18N.en['cat_' + b.cat] || ''}`.toLowerCase().includes(q)));
  if (ui.sort === 'az') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (ui.sort === 'price') list = list.slice().sort((a, b) => Math.min(...a.amounts) - Math.min(...b.amounts));
  return list;
}
function gridHTML() {
  const list = catalogList(), q = ui.q.trim();
  return list.length ? `<div class="grid">${list.map(b => bcard(b, 'h2')).join('')}</div>`
    : `<div class="empty"><span class="eic">${ic('search')}</span><h2>${te('noFound')}</h2><p>${q ? (ui.cat !== 'all' ? te('noMatchIn', { q, cat: catName(ui.cat) }) : te('noMatch', { q })) + ' ' : ''}${te('tryAnother')}</p><button class="btn ghost" data-act="clear">${te('showAll')}</button></div>`;
}
function All() {
  const cats = ['all', ...new Set(liveBrands().map(b => b.cat))];
  const c = route.q && cats.includes(route.q) ? route.q : '';
  ui.cat = c || 'all';
  const inCat = liveBrands().filter(b => !c || b.cat === c);
  return `<div class="wrap">
    ${c ? `<nav class="crumbs" aria-label="${te('crumbs')}">${A('home', '', '', te('crumbHome'))}${ic('chevR')}${A('all', '', '', te('allCards'))}${ic('chevR')}<span aria-current="page">${esc(catName(c))}</span></nav>` : ''}
    <div class="page-h"><h1>${c ? te('catH', { cat: catName(c) }) : te('allCards')}</h1><p>${c ? te('catIntro', { n: inCat.length, cat: catName(c) }) : te('allSub', { n: liveBrands().length })}</p></div>
    <div class="cbar">
      <form class="hsearch" role="search" action="${PATH_MODE ? pathOf('all') : '#'}" data-search>${ic('search')}<label class="sr" for="cq">${te('searchLbl')}</label><input id="cq" name="q" type="search" placeholder="${te('searchBrands')}" autocomplete="off" value="${esc(ui.q)}"></form>
      ${catLinks(cats)}
      <label class="sortsel">${te('sort')}<select id="sort"><option value="popular"${ui.sort === 'popular' ? ' selected' : ''}>${te('sortPop')}</option><option value="price"${ui.sort === 'price' ? ' selected' : ''}>${te('sortPrice')}</option><option value="az"${ui.sort === 'az' ? ' selected' : ''}>${te('sortAz')}</option></select></label>
    </div>
    <div id="cgrid">${gridHTML()}</div>
    ${updatedLine()}</div>`;
}
function priceTable(b, vSel) {
  return `<section class="ptable" aria-labelledby="pt-h"><h2 id="pt-h">${te('priceTblH', { brand: b.name })}</h2>
    <div class="tscroll"><table><thead><tr><th scope="col">${te('thValue')}</th><th scope="col">${te('thPrice')}</th><th scope="col">${te('thVat')}</th><th scope="col">${te('thAvail')}</th></tr></thead><tbody>
    ${b.amounts.map(v => { const a = availOf(b.id, v); return `<tr${v === vSel ? ' class="sel"' : ''}><th scope="row">${A('brand', b.id, '', te('valName', { brand: b.name, v: usd(v) }), { v })}</th><td>${fmt(priceOf(v))}</td><td>${fmt(vatOf(priceOf(v)))}</td><td>${a === 'pre' ? `${te('preorder')} · ${te('expBy', { date: dmy(etaOf(b.id, v)) })}` : te('availInS')}</td></tr>`; }).join('')}
    </tbody></table></div>${updatedLine()}</section>`;
}
function brandFaq(b, l = lang) {
  const list = b.amounts.map(v => `${usd(v)}: ${fmt(priceOf(v))}`).join(', ');
  return [1, 2, 3, 4].map(n => [tl(l, 'bq' + n, { brand: b.name }), tl(l, 'ba' + n, { brand: b.name, list, vat: vatPct() })]);
}
function Brand() {
  const b = BR[route.q];
  if (!live(b)) return NotFound();
  let v = route.v && b.amounts.includes(route.v) ? route.v : ui.pv[b.id];
  if (!b.amounts.includes(v)) v = b.amounts.find(x => !isOut(b.id, x)) || b.amounts[0];
  ui.pv[b.id] = v;
  const a = availOf(b.id, v), price = priceOf(v), cap = a === 'pre' ? 10 : Math.min(10, stockOf(b.id, v));
  if (ui.qty > cap) ui.qty = cap;
  const more = liveBrands().filter(x => x.id !== b.id).sort((x, y) => (y.cat === b.cat) - (x.cat === b.cat)).slice(0, 4);
  const bn = b.label || b.name, lo = Math.min(...b.amounts), hi = Math.max(...b.amounts), isVal = !!(route.v && b.amounts.includes(route.v));
  return `<div class="wrap">
    <nav class="crumbs" aria-label="${te('crumbs')}">${A('home', '', '', te('crumbHome'))}${ic('chevR')}${A('all', b.cat, '', esc(catName(b.cat)))}${ic('chevR')}${isVal ? `${A('brand', b.id, '', esc(b.name))}${ic('chevR')}<span aria-current="page">${usd(v)}</span>` : `<span aria-current="page">${esc(b.name)}</span>`}</nav>
    <div class="pd">
      <div class="pd-art">${pkg(b.id, v, 'ETH', false, a === 'pre')}</div>
      <div class="pd-info">
        <span class="cat">${esc(catName(b.cat))}</span>
        <h1>${isVal ? te('valName', { brand: b.name, v: usd(v) }) : te('cardTitle', { name: b.name })}</h1>
        <p class="sub">${te('pdSub')}</p>
        <span class="lbl" id="vlbl">${te('chooseVal')}</span>
        <nav class="vopts" aria-labelledby="vlbl">${b.amounts.map(x => A('brand', b.id, 'vopt', `${isOut(b.id, x) ? `<span class="pre" title="${te('preorder')}">${ic('clock')}</span>` : ''}<b>${usd(x)}</b><small>${fmt(priceOf(x))}</small>`, { v: x, attrs: x === v ? ' aria-current="true"' : '' })).join('')}</nav>
        <div class="price"><b>${fmt(price * ui.qty)}</b><small>${ui.qty > 1 ? `${ui.qty} × ${fmt(price)} · ` : ''}${te('vatIncl', { vat: fmt(vatOf(price * ui.qty)) })}</small></div>
        ${a === 'pre' ? `<div class="avail pre">${ic('clock')}<span><b>${te('avPreB')}</b> ${te('avPre', { date: dmy(etaOf(b.id, v)) })}</span></div>`
          : a === 'low' ? `<div class="avail low">${ic('clock')}<span><b>${te('avLowB', { n: stockOf(b.id, v) })}</b> ${te('avLow')}</span></div>`
          : `<div class="avail ok">${ic('check')}<span><b>${te('avOkB')}</b> ${te('avOk')}</span></div>`}
        <div class="buy">
          <div class="qty" role="group" aria-label="${te('qty')}"><button data-qty="-1" aria-label="${te('less')}"${ui.qty <= 1 ? ' disabled' : ''}>${ic('minus')}</button><output aria-live="polite">${ui.qty}</output><button data-qty="1" aria-label="${te('more')}"${ui.qty >= cap ? ' disabled' : ''}>${ic('plus')}</button></div>
          <button class="btn ghost lg" data-act="add" data-bid="${b.id}" data-v="${v}">${ic('cart')}${te('addCart')}</button>
          <button class="btn lg" data-act="buynow" data-bid="${b.id}" data-v="${v}">${a === 'pre' ? te('preNow') : te('buyNow')}</button>
        </div>
        <ul class="notes">
          <li>${BOLT_LINE.replace('<svg', '<svg class="bolt"')}<span>${te('n1')}</span></li>
          <li>${ic('mail')}<span>${te('n2')}</span></li>
          <li>${ic('nonret')}<span>${te('n3')}</span></li>
        </ul>
      </div>
    </div>
    <section class="about"><p>${isVal ? te('valIntro', { brand: b.name, v: usd(v), price: fmt(price), vatAmt: fmt(vatOf(price)) }) : te('brandIntro', { brand: b.name, lo: usd(lo), hi: usd(hi), plo: fmt(priceOf(lo)), phi: fmt(priceOf(hi)), vat: vatPct() })}</p></section>
    ${priceTable(b, isVal ? v : null)}
    <section class="redeem"><h2>${te('redeemH', { brand: bn })}</h2><ol>
      <li>${te('r1', { brand: bn })}</li>
      <li>${te('r2')}</li>
      <li>${te('r3')}</li>
    </ol></section>
    <section class="sec bfaq"><h2>${te('bfaqH', { brand: b.name })}</h2><div class="faq">${brandFaq(b).map(([q, ans]) => `<details><summary>${esc(q)}${ic('chevD')}</summary><p>${esc(ans)}</p></details>`).join('')}</div></section>
    ${more.length ? `<section class="sec"><div class="sec-h"><h2>${te('alsoLike')}</h2></div><div class="grid">${more.map(x => bcard(x)).join('')}</div></section>` : ''}
  </div>`;
}
function NotFound() {
  return `<div class="wrap"><div class="empty"><span class="eic">${ic('search')}</span><h1>${te('naH')}</h1><p>${te('naP')}</p>${A('all', '', 'btn', te('seeAll'))}</div></div>`;
}
function Cart() {
  if (!cart.length) return `<div class="wrap"><div class="page-h"><h1>${te('cartH')}</h1></div><div class="empty"><span class="eic">${ic('cart')}</span><h2>${te('cartEmptyH')}</h2><p>${te('cartEmptyP')}</p>${A('all', '', 'btn', te('browse'))}</div></div>`;
  const total = cartTotal(), pre = cart.some(it => isOut(it.bid, it.amount));
  return `<div class="wrap"><div class="page-h"><h1>${te('cartH')}</h1><p>${esc(cardsN(cartCount()))}</p></div>
    <div class="cart">
      <div class="lines">${cart.map((it, i) => {
        const out = isOut(it.bid, it.amount), cap = out ? 10 : Math.min(10, stockOf(it.bid, it.amount));
        return `<div class="cline">
          <div class="thumb">${pkg(it.bid, it.amount, 'ETH', true, out)}</div>
          <div><h3>${A('brand', it.bid, '', esc(cardName(it.bid, it.amount)), { v: it.amount })}</h3>
            <p class="meta">${te('each', { price: fmt(priceOf(it.amount)) })}</p>
            <div class="acts"><div class="qty" role="group" aria-label="${te('qtyOf', { name: cardName(it.bid, it.amount) })}"><button data-cq="${i}|-1" aria-label="${te('less')}"${it.qty <= 1 ? ' disabled' : ''}>${ic('minus')}</button><output>${it.qty}</output><button data-cq="${i}|1" aria-label="${te('more')}"${it.qty >= cap ? ' disabled' : ''}>${ic('plus')}</button></div>
              <button class="rm" data-rm="${i}">${ic('trash')}${te('remove')}</button></div>
            ${out ? `<div class="pre-note">${ic('clock')}${te('preExp', { date: dmy(etaOf(it.bid, it.amount)) })}</div>` : ''}
          </div>
          <div class="amt">${fmt(priceOf(it.amount) * it.qty)}</div>
        </div>`; }).join('')}</div>
      <aside class="summary" aria-label="${te('summary')}"><h2>${te('summary')}</h2>
        <dl class="kv"><dt>${te('subtotal')}</dt><dd>${fmt(total)}</dd><dt>${te('vatPctL', { vat: vatPct() })}</dt><dd>${fmt(vatOf(total))}</dd><dt>${te('delivery')}</dt><dd>${te('deliveryFree')}</dd><dt class="tot">${te('total')}</dt><dd class="tot">${fmt(total)}</dd></dl>
        <button class="btn lg block" data-act="checkout" style="margin-top:20px">${session ? te('checkout') : te('signToCheck')}</button>
        <div class="paywith">${te('payWith')} <span class="mpesa">M-PESA</span></div>
        ${pre ? `<p class="fine">${te('preFine')}</p>` : ''}
        <p class="fine">${te('noRefundFine')}</p>
      </aside>
    </div></div>`;
}
function codesHTML(o, i, it) {
  return (it.codes || []).map((c, ci) => { const key = `${o.id}-${i}-${ci}`, vis = ui.rev.has(key); return `<div class="code"><span>${esc(vis ? c : maskCode(c))}</span><button data-rev="${key}" aria-label="${vis ? te('hideCode') : te('showCode')}" aria-pressed="${vis}">${ic(vis ? 'eyeOff' : 'eye')}</button><button data-copy="${esc(c)}" aria-label="${te('copyCode')}">${ic('copy')}</button></div>`; }).join('');
}
function Orders() {
  if (!session) return `<div class="wrap"><div class="page-h"><h1>${te('myOrders')}</h1></div><div class="empty"><span class="eic">${ic('receipt')}</span><h2>${te('signSeeH')}</h2><p>${te('signSeeP')}</p><button class="btn" data-act="signin">${te('signIn')}</button></div></div>`;
  const list = myOrders();
  if (!list.length) return `<div class="wrap"><div class="page-h"><h1>${te('myOrders')}</h1></div><div class="empty"><span class="eic">${ic('receipt')}</span><h2>${te('noOrdersH')}</h2><p>${te('noOrdersP')}</p>${A('all', '', 'btn', te('browse'))}</div></div>`;
  return `<div class="wrap"><div class="page-h"><h1>${te('myOrders')}</h1><p>${te('signedAs', { name: session.name, phone: session.phone })}</p></div>
    <div class="olist">${list.map(o => {
      const wait = o.items.filter(it => it.status === 'waiting').length, del = o.items.length - wait;
      const st = !wait ? `<span class="st ok">${ic('check')}${te('stDelivered')}</span>` : del ? `<span class="st pre">${ic('clock')}${te('stPartly')}</span>` : `<span class="st pre">${ic('clock')}${te('stWaiting')}</span>`;
      const total = o.items.reduce((x, it) => x + (it.unit != null ? it.unit : priceOf(it.amount)) * it.qty, 0);
      return `<article class="ocard"><div class="oh"><b>${esc(o.id)}</b><small>${esc(fmtWhen(o.at))}</small>${st}${o.channel === 'web' ? '' : `<span class="st muted">${te('mpesaApp')}</span>`}<span class="tot">${fmt(total)}</span></div>
        <div class="oitems">${o.items.map((it, i) => `<div class="oit"><div class="thumb">${BR[it.bid] ? pkg(it.bid, it.amount, 'ETH', true, it.status === 'waiting') : ''}</div><div>
          <h3>${esc(BR[it.bid] ? cardName(it.bid, it.amount) : t('cardOf', { v: usd(it.amount) }))} × ${it.qty}${it.status === 'waiting' ? `<span class="st pre">${ic('clock')}${te('expBy', { date: dmy(it.eta || etaOf(it.bid, it.amount)) })}</span>` : ''}</h3>
          ${it.status === 'waiting' ? `<p class="hint" style="margin:6px 0 0">${te('paidWait')}</p>` : `<div class="codes">${codesHTML(o, i, it)}</div>`}
        </div></div>`).join('')}</div>
        <div class="ofoot"><span>${ic('wallet')}${te('paidMpesa')}${o.payPhone ? ` · ${esc(o.payPhone)}` : ''}</span>${o.smsTo ? `<span>${ic('phone')}${te('sentSms', { to: o.smsTo })}</span>` : o.email ? `<span>${ic('mail')}${te('sentMail', { to: o.email })}</span>` : ''}</div>
      </article>`; }).join('')}</div></div>`;
}
const helpFaq = (l = lang) => [1, 2, 3, 4, 5, 6].map(n => [tl(l, 'q' + n), tl(l, 'a' + n)]);
function Help() {
  const sp = cfg.support, ch = [];
  if (sp.phone) ch.push(`<a class="ch" href="tel:${esc(sp.phone.replace(/[^\d+]/g, ''))}"><span class="cic">${ic('phone')}</span><span><b>${te('call')}</b><small>${esc(sp.phone)}</small></span></a>`);
  if (sp.telegram) ch.push(`<a class="ch" href="https://t.me/${esc(sp.telegram.replace(/^@/, ''))}" target="_blank" rel="noopener"><span class="cic">${ic('tg')}</span><span><b>Telegram</b><small>@${esc(sp.telegram.replace(/^@/, ''))}</small></span></a>`);
  if (sp.whatsapp) ch.push(`<a class="ch" href="https://wa.me/${esc(sp.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener"><span class="cic">${ic('chat')}</span><span><b>WhatsApp</b><small>${esc(sp.whatsapp)}</small></span></a>`);
  if (sp.email) ch.push(`<a class="ch" href="mailto:${esc(sp.email)}"><span class="cic">${ic('mail')}</span><span><b>${te('emailL')}</b><small>${esc(sp.email)}</small></span></a>`);
  return `<div class="wrap"><div class="page-h"><h1>${te('navHelp')}</h1><p>${te('helpSub')}</p></div>
    <div class="help">
      <div><div class="faq">${helpFaq().map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}${ic('chevD')}</summary><p>${esc(a)}</p></details>`).join('')}</div>
        <div class="legal">
          <section id="terms"><h2>${te('terms')}</h2><p>${te('termsP1', { vat: vatPct() })}</p><p>${te('termsP2')}</p></section>
          <section id="refunds"><h2>${te('norefund')}</h2><p>${te('refundP1')}</p><p>${te('refundP2')}</p></section>
          <section id="privacy"><h2>${te('privacy')}</h2><p>${te('privP1')}</p><p>${te('privP2')}</p></section>
        </div>
      </div>
      <aside class="contact" id="contact"><h2>${te('contactUs')}</h2><p>${sp.from && sp.to ? te('contactHours', { from: sp.from, to: sp.to }) : te('replySoon')}</p>${ch.join('') || `<p class="hint">${te('contactSoon')}</p>`}</aside>
    </div></div>`;
}
const PAGES = { home: Home, all: All, brand: Brand, cart: Cart, orders: Orders, help: Help, notfound: NotFound };
function render() {
  document.documentElement.lang = lang;
  drawHeader();
  document.getElementById('main').innerHTML = PAGES[route.p]();
  applySEO();
}
function renderMain() { document.getElementById('main').innerHTML = PAGES[route.p](); }

/* ================= SEO: titles, descriptions, languages, structured data ================= */
function seoOf(r = route, l = lang) {
  const T = (k, v) => tl(l, k, v), out = { index: true, ld: [] };
  const crumbs = items => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })) });
  const org = { '@type': 'Organization', '@id': SITE_URL + '/#org', name: 'eCards', url: SITE_URL + '/', logo: SITE_URL + '/assets/og/logo-512.png',
    contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', areaServed: 'ET', availableLanguage: LANGS.map(x => x.en), ...(cfg.support.phone ? { telephone: cfg.support.phone } : {}), ...(cfg.support.email ? { email: cfg.support.email } : {}) }] };
  const home = urlOf('home', '', { lang: l });
  if (r.p === 'home') {
    out.title = T('seoHomeT'); out.desc = T('seoHomeD'); out.image = 'default';
    out.ld.push(org, { '@type': 'WebSite', '@id': SITE_URL + '/#site', name: 'eCards', url: home, inLanguage: l, publisher: { '@id': SITE_URL + '/#org' },
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: urlOf('all', '', { lang: l }) + '?q={search_term_string}' }, 'query-input': 'required name=search_term_string' } });
  } else if (r.p === 'all') {
    const c = r.q, list = liveBrands().filter(b => !c || b.cat === c);
    out.title = c ? T('seoCatT', { cat: catNameL(l, c) }) : T('seoAllT');
    out.desc = c ? T('seoCatD', { cat: catNameL(l, c), brands: list.slice(0, 5).map(b => b.name).join(', ') }) : T('seoAllD', { n: liveBrands().length });
    out.image = 'default';
    out.ld.push(crumbs([[T('crumbHome'), home], [T('allCards'), urlOf('all', '', { lang: l })], ...(c ? [[catNameL(l, c), urlOf('all', c, { lang: l })]] : [])]),
      { '@type': 'ItemList', name: out.title, itemListElement: list.map((b, i) => ({ '@type': 'ListItem', position: i + 1, url: urlOf('brand', b.id, { lang: l }), name: T('cardTitle', { name: b.name }) })) });
    if (ui.q && r === route) out.index = false;   // search results are not indexed
  } else if (r.p === 'brand' && live(BR[r.q])) {
    const b = BR[r.q], lo = Math.min(...b.amounts), hi = Math.max(...b.amounts), v = r.v && b.amounts.includes(r.v) ? r.v : null;
    const offer = x => { const a = isOut(b.id, x); return { '@type': 'Offer', url: urlOf('brand', b.id, { lang: l, v: x }), price: priceOf(x).toFixed(2), priceCurrency: 'ETB', availability: a ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock', ...(a ? { availabilityStarts: new Date(etaOf(b.id, x)).toISOString() } : {}), itemCondition: 'https://schema.org/NewCondition', priceValidUntil: isoDate(Date.now() + 30 * 864e5), seller: { '@id': SITE_URL + '/#org' }, areaServed: 'ET', hasMerchantReturnPolicy: { '@type': 'MerchantReturnPolicy', applicableCountry: 'ET', returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' } }; };
    out.image = b.id;
    const img = SITE_URL + `/assets/og/${b.id}.jpg`;
    if (v) {
      out.title = T('seoValT', { brand: b.label || b.name, v: usd(v), price: fmt(priceOf(v)) });
      out.desc = T('seoValD', { brand: b.name, v: usd(v), price: fmt(priceOf(v)), vat: vatPct(), avail: isOut(b.id, v) ? T('availPreS', { date: dmy(etaOf(b.id, v)) }) : T('availIn') });
      out.ld.push({ '@type': 'Product', name: T('valName', { brand: b.name, v: usd(v) }), sku: `${b.id}-${v}`, category: 'Gift Cards & Certificates', brand: { '@type': 'Brand', name: b.name }, image: img, description: out.desc, offers: offer(v) });
    } else {
      out.title = T('seoBrandT', { brand: b.label || b.name, price: fmt(priceOf(lo)) });
      out.desc = T('seoBrandD', { brand: b.name, price: fmt(priceOf(lo)), range: lo === hi ? usd(lo) : `${usd(lo)}–${usd(hi)}` });
      out.ld.push({ '@type': 'Product', name: T('cardTitle', { name: b.name }), sku: b.id, category: 'Gift Cards & Certificates', brand: { '@type': 'Brand', name: b.name }, image: img, description: out.desc,
        offers: { '@type': 'AggregateOffer', priceCurrency: 'ETB', lowPrice: priceOf(lo).toFixed(2), highPrice: priceOf(hi).toFixed(2), offerCount: b.amounts.length, offers: b.amounts.map(offer) } });
    }
    out.ld.push(crumbs([[T('crumbHome'), home], [catNameL(l, b.cat), urlOf('all', b.cat, { lang: l })], [b.name, urlOf('brand', b.id, { lang: l })], ...(v ? [[usd(v), urlOf('brand', b.id, { lang: l, v })]] : [])]),
      { '@type': 'FAQPage', mainEntity: brandFaq(b, l).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  } else if (r.p === 'help') {
    out.title = T('seoHelpT'); out.desc = T('seoHelpD'); out.image = 'default';
    out.ld.push(org, { '@type': 'FAQPage', mainEntity: helpFaq(l).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  } else {
    out.title = r.p === 'cart' ? T('cartH') : r.p === 'orders' ? T('myOrders') : T('naH'); out.desc = T('seoHomeD'); out.index = false; out.image = 'default';
  }
  out.title = out.title.replace(/M‑Pesa/g, 'M-Pesa'); out.desc = out.desc.replace(/M‑Pesa/g, 'M-Pesa');
  if (r.p !== 'notfound') { out.canonical = urlOf(r.p, r.q, { lang: l, v: r.v }); out.alternates = LANGS.map(x => [x.code, urlOf(r.p, r.q, { lang: x.code, v: r.v })]); }
  return out;
}
function upsert(sel, make) { let el = document.head.querySelector(sel); if (!el) { el = make(); document.head.appendChild(el); } return el; }
const metaEl = (attr, key, val) => { const el = upsert(`meta[${attr}="${key}"]`, () => { const m = document.createElement('meta'); m.setAttribute(attr, key); return m; }); el.setAttribute('content', val); };
function applySEO() {
  const s = seoOf();
  document.title = s.title;
  metaEl('name', 'description', s.desc);
  metaEl('name', 'robots', s.index ? 'index, follow, max-image-preview:large' : 'noindex, follow');
  document.head.querySelectorAll('link[data-seo]').forEach(x => x.remove());
  const link = (rel, href, extra = {}) => { const el = document.createElement('link'); el.rel = rel; el.href = href; el.dataset.seo = '1'; Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v)); document.head.appendChild(el); };
  if (s.canonical) {
    link('canonical', s.canonical);
    s.alternates.forEach(([c, u]) => link('alternate', u, { hreflang: c }));
    link('alternate', s.alternates[0][1], { hreflang: 'x-default' });
    if (route.p === 'brand' || route.p === 'all' || route.p === 'home' || route.p === 'help') link('alternate', s.canonical + 'index.md', { type: 'text/markdown', title: 'Markdown' });
  }
  const L = LANGS.find(x => x.code === lang);
  metaEl('property', 'og:type', route.p === 'brand' ? 'product' : 'website');
  metaEl('property', 'og:site_name', 'eCards');
  metaEl('property', 'og:title', s.title);
  metaEl('property', 'og:description', s.desc);
  metaEl('property', 'og:url', s.canonical || SITE_URL + '/');
  metaEl('property', 'og:locale', L.locale);
  metaEl('property', 'og:image', `${SITE_URL}/assets/og/${s.image}.jpg`);
  metaEl('property', 'og:image:width', '1200'); metaEl('property', 'og:image:height', '630');
  metaEl('name', 'twitter:card', 'summary_large_image');
  const ld = upsert('script#ec-ld', () => { const sc = document.createElement('script'); sc.type = 'application/ld+json'; sc.id = 'ec-ld'; return sc; });
  ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': s.ld }).replace(/</g, '\\u003c');
}

/* ================= for search engines and AI assistants: the site build calls these ================= */
function mdFor(r, l) {
  const T = (k, v) => tl(l, k, v), url = urlOf(r.p, r.q, { lang: l, v: r.v }), lines = [];
  const facts = [T('mdFact1', { vat: vatPct(), rate: num(RATE) }), T('mdFact2'), T('mdFact3'), T('mdFact4')];
  if (r.p === 'brand') {
    const b = BR[r.q], v = r.v;
    lines.push(`# ${v ? T('valName', { brand: b.name, v: usd(v) }) : T('cardTitle', { name: b.name })}`, '', `> ${seoOf(r, l).desc}`, '', `URL: ${url}`, `${T('updated', { date: isoDate(Date.now()), rate: num(RATE) })}`, '');
    lines.push(`## ${T('priceTblH', { brand: b.name })}`, '', `| ${T('thValue')} | ${T('thPrice')} | ${T('thVat')} | ${T('thAvail')} |`, '|---|---|---|---|');
    b.amounts.forEach(x => lines.push(`| [${usd(x)}](${urlOf('brand', b.id, { lang: l, v: x })}) | ${fmt(priceOf(x))} | ${fmt(vatOf(priceOf(x)))} | ${isOut(b.id, x) ? `${T('preorder')} (${T('expBy', { date: isoDate(etaOf(b.id, x)) })})` : T('availInS')} |`));
    lines.push('', `## ${T('redeemH', { brand: b.label || b.name })}`, '', `1. ${T('r1', { brand: b.label || b.name })}`, `2. ${T('r2')}`, `3. ${T('r3')}`, '', `## ${T('bfaqH', { brand: b.name })}`, '');
    brandFaq(b, l).forEach(([q, a]) => lines.push(`### ${q}`, '', a, ''));
  } else if (r.p === 'all' || r.p === 'home') {
    const c = r.p === 'all' ? r.q : '', list = liveBrands().filter(b => !c || b.cat === c);
    lines.push(`# ${r.p === 'home' ? T('heroH') : c ? T('catH', { cat: catNameL(l, c) }) : T('allCards')}`, '', `> ${seoOf(r, l).desc}`, '', `URL: ${url}`, '');
    lines.push(`## ${T('mdFacts')}`, '', ...facts.map(f => `- ${f}`), '', `## ${T('giftCards')}`, '');
    list.forEach(b => lines.push(`- [${T('cardTitle', { name: b.name })}](${urlOf('brand', b.id, { lang: l })}): ${catNameL(l, b.cat)}, ${b.amounts.map(usd).join(', ')}, ${T('from').toLowerCase()} ${fmt(priceOf(Math.min(...b.amounts)))}`));
  } else if (r.p === 'help') {
    lines.push(`# ${T('navHelp')}`, '', `URL: ${url}`, '', `## ${T('qa')}`, '');
    helpFaq(l).forEach(([q, a]) => lines.push(`### ${q}`, '', a, ''));
    lines.push(`## ${T('terms')}`, '', T('termsP1', { vat: vatPct() }), '', T('termsP2'), '', `## ${T('norefund')}`, '', T('refundP1'), '', T('refundP2'), '', `## ${T('privacy')}`, '', T('privP1'), '', T('privP2'), '');
    const sp = cfg.support;
    lines.push(`## ${T('contactUs')}`, '', ...[sp.phone && `- ${T('call')}: ${sp.phone}`, sp.telegram && `- Telegram: @${sp.telegram.replace(/^@/, '')}`, sp.whatsapp && `- WhatsApp: ${sp.whatsapp}`, sp.email && `- ${T('emailL')}: ${sp.email}`, sp.from && sp.to && `- ${T('contactHours', { from: sp.from, to: sp.to })}`].filter(Boolean));
  }
  return lines.join('\n').replace(/M‑Pesa/g, 'M-Pesa') + '\n';
}
function indexRoutes() {   // every page that should be in search engines, in every language
  const rs = [{ p: 'home', q: '' }, { p: 'all', q: '' }, { p: 'help', q: '' }];
  [...new Set(liveBrands().map(b => b.cat))].forEach(c => rs.push({ p: 'all', q: c }));
  liveBrands().forEach(b => { rs.push({ p: 'brand', q: b.id }); b.amounts.forEach(v => rs.push({ p: 'brand', q: b.id, v })); });
  return rs;
}
const xmlEsc = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
window.__SEO = {
  site: SITE_URL,
  langs: LCODES,
  pages() {   // [{path, lang, index}] for the build
    const out = [];
    LCODES.forEach(l => { indexRoutes().forEach(r => out.push({ path: pathOf(r.p, r.q, { lang: l, v: r.v }), lang: l, index: true, md: true })); ['cart', 'orders'].forEach(p => out.push({ path: pathOf(p, '', { lang: l }), lang: l, index: false })); });
    return out;
  },
  render(path) { closeModal(true); ui.q = ''; ui.qty = 1; ui.menu = false; ui.langMenu = false; ui.pv = {}; applyRoute(parsePath(path)); render(); drawFooter(); window.scrollTo(0, 0); return document.title; },
  markdown(path) { const r = parsePath(path); return mdFor(r, r.lang); },
  sitemap() {
    const today = isoDate(Date.now());
    const urls = indexRoutes().flatMap(r => LCODES.map(l => {
      const alts = LCODES.map(x => `<xhtml:link rel="alternate" hreflang="${x}" href="${xmlEsc(urlOf(r.p, r.q, { lang: x, v: r.v }))}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${xmlEsc(urlOf(r.p, r.q, { lang: 'en', v: r.v }))}"/>`;
      return `<url><loc>${xmlEsc(urlOf(r.p, r.q, { lang: l, v: r.v }))}</loc><lastmod>${today}</lastmod>${alts}</url>`;
    }));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  },
  catalog() {
    return JSON.stringify({ name: 'eCards', url: SITE_URL + '/', updated: new Date().toISOString(), currency: 'ETB', vatRate: VAT, vatIncluded: true, birrPerUSD: RATE, payment: ['M-Pesa'], delivery: ['SMS', 'email'], refunds: false, languages: LCODES,
      items: liveBrands().flatMap(b => b.amounts.map(v => ({ id: `${b.id}-${v}`, brand: b.name, category: tl('en', 'cat_' + b.cat), valueUSD: v, priceETB: +priceOf(v).toFixed(2), vatETB: +vatOf(priceOf(v)).toFixed(2), availability: isOut(b.id, v) ? 'preorder' : 'in_stock', ...(isOut(b.id, v) ? { expected: isoDate(etaOf(b.id, v)) } : {}), url: urlOf('brand', b.id, { lang: 'en', v }), urls: Object.fromEntries(LCODES.map(l => [l, urlOf('brand', b.id, { lang: l, v })])) }))) }, null, 2) + '\n';
  },
  merchantFeed() {   // Google Merchant Center product feed (RSS 2.0)
    const items = liveBrands().flatMap(b => b.amounts.map(v => { const out = isOut(b.id, v); return `<item><g:id>${b.id}-${v}</g:id><title>${xmlEsc(tl('en', 'valName', { brand: b.name, v: usd(v) }))}</title><description>${xmlEsc(seoOf({ p: 'brand', q: b.id, v }, 'en').desc)}</description><link>${xmlEsc(urlOf('brand', b.id, { lang: 'en', v }))}</link><g:image_link>${SITE_URL}/assets/og/${b.id}.jpg</g:image_link><g:price>${priceOf(v).toFixed(2)} ETB</g:price><g:availability>${out ? 'preorder' : 'in_stock'}</g:availability>${out ? `<g:availability_date>${new Date(etaOf(b.id, v)).toISOString()}</g:availability_date>` : ''}<g:condition>new</g:condition><g:brand>${xmlEsc(b.name)}</g:brand><g:product_type>Gift Cards &amp; Certificates &gt; ${xmlEsc(tl('en', 'cat_' + b.cat))}</g:product_type><g:identifier_exists>no</g:identifier_exists><g:is_bundle>no</g:is_bundle></item>`; }));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>eCards gift cards</title><link>${SITE_URL}/</link><description>Digital gift cards for Ethiopia, priced in Birr with VAT included.</description>\n${items.join('\n')}\n</channel></rss>\n`;
  },
  llms() {
    const T = (k, v) => tl('en', k, v), brands = popularOrder();
    const head = [`# eCards`, '', `> ${T('llmsSummary', { vat: vatPct() })}`, '', T('llmsIntro'), '', `## ${T('mdFacts')}`, '', ...[T('mdFact1', { vat: vatPct(), rate: num(RATE) }), T('mdFact2'), T('mdFact3'), T('mdFact4'), T('mdFact5')].map(f => `- ${f}`), ''];
    const short = [...head, '## Gift cards', '', ...brands.map(b => `- [${T('cardTitle', { name: b.name })}](${urlOf('brand', b.id, { lang: 'en' })}index.md): ${b.amounts.map(usd).join(', ')}; from ${fmt(priceOf(Math.min(...b.amounts)))}`), '',
      '## Help and policies', '', `- [Help, FAQ, terms, refund and privacy policies](${urlOf('help', '', { lang: 'en' })}index.md)`, `- [All gift cards](${urlOf('all', '', { lang: 'en' })}index.md)`, '',
      '## Data', '', `- [Catalog with every card, price and availability (JSON)](${SITE_URL}/catalog.json)`, `- [Full content for AI assistants in one file](${SITE_URL}/llms-full.txt)`, `- [Sitemap](${SITE_URL}/sitemap.xml)`, '',
      '## Other languages', '', ...LANGS.filter(x => x.code !== 'en').map(x => `- ${x.en} (${x.native}): ${urlOf('home', '', { lang: x.code })}`), '',
      '## Optional', '', `- [Home page](${urlOf('home', '', { lang: 'en' })}index.md)`, ''].join('\n');
    const full = [...head, ...brands.map(b => mdFor({ p: 'brand', q: b.id }, 'en')), mdFor({ p: 'help', q: '' }, 'en')].join('\n');
    return { short: short.replace(/M‑Pesa/g, 'M-Pesa'), full: full.replace(/M‑Pesa/g, 'M-Pesa') };
  },
  og(id) {   // a 1200×630 share picture for a brand, or the default one
    const b = BR[id];
    document.body.innerHTML = `<div class="og"><div class="og-l"><span class="logo">${ecLogo()}<b>eCards</b></span><h1>${b ? esc(tl('en', 'cardTitle', { name: b.name })) : 'Gift cards in Ethiopia'}</h1>
      <p>${b ? `${b.amounts.map(usd).join(' · ')}<br>from ${fmt(priceOf(Math.min(...b.amounts)))}` : 'Netflix, PlayStation, Spotify, Steam and more'}</p><span class="og-pill">${BOLT}Pay with M-Pesa · prices in Birr</span></div>
      <div class="og-r">${b ? `<div class="og-card">${pkg(b.id, Math.min(...b.amounts), 'ETH')}</div>` : ART.slice(0, 5).filter(([x]) => BR[x]).map(([x, , , w], i) => `<div class="og-fl og-f${i}">${pkg(x, [100, 50, 200, 150][i % 4], 'ETH')}</div>`).join('')}</div></div>`;
  }
};

/* ---------- cart actions ---------- */
function addToCart(bid, v, qty) {
  const f = cart.find(it => it.bid === bid && it.amount === v), cap = isOut(bid, v) ? 10 : Math.min(10, stockOf(bid, v));
  const now = f ? f.qty : 0, add = Math.max(0, Math.min(qty, cap - now));
  if (!add) { toast(t('maxBuy', { n: cap })); return false; }
  if (f) f.qty += add; else cart.push({ bid, region: 'ETH', amount: v, qty: add });
  saveCart();
  return true;
}

/* ---------- modal ---------- */
let modal = null;
function openModal(html, opts = {}) {
  closeModal(true);
  const w = document.createElement('div');
  w.className = 'mwrap';
  w.innerHTML = `<div class="mback" data-mclose></div><div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.label || '')}"><button class="mx" data-mclose aria-label="${te('close')}">${ic('close')}</button><div class="mbody">${html}</div></div>`;
  document.body.appendChild(w);
  modal = { w, last: document.activeElement, onClose: opts.onClose };
  w.addEventListener('click', e => { if (e.target.closest('[data-mclose]') && !w.dataset.lock) closeModal(); });
  requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add('open')));
  document.querySelectorAll('body > header, body > main, body > footer').forEach(el => { el.inert = true; });
  setTimeout(() => { const f = w.querySelector('input:not([type=checkbox]), .modal button.btn'); if (f) f.focus(); }, 60);
  return w;
}
function closeModal(quick) {
  if (!modal) return;
  const { w, last, onClose } = modal; modal = null;
  document.querySelectorAll('body > header, body > main, body > footer').forEach(el => { el.inert = false; });
  if (onClose) onClose();
  if (quick) w.remove(); else { w.classList.remove('open'); setTimeout(() => w.remove(), 220); }
  if (last && last.focus && document.contains(last)) last.focus({ preventScroll: true });
}
const mbody = () => modal && modal.w.querySelector('.mbody');
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && !modal.w.dataset.lock) closeModal(); });

/* ---------- sign in with phone number + one-time code (demo: no SMS is sent) ---------- */
function openSignIn(then) {
  const st = { step: 'phone', phone: '', code: '', sentAt: 0, tries: 0 };
  let tmr = null;
  openModal('', { label: t('signIn'), onClose: () => clearInterval(tmr) });
  const resendTxt = left => left ? t('resendIn', { s: left }) : t('resendNew');
  const draw = (err, focus = true) => {
    const b = mbody(); if (!b) return;
    if (st.step === 'phone') b.innerHTML = `<h2>${te('siH')}</h2><p class="msub">${te('siP')}</p>
      <form id="sf" novalidate><div class="field"><label for="s-phone">${te('phoneL')}</label><div class="inp${err ? ' err' : ''}"><span class="cc">+251</span><input id="s-phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="9X XXX XXXX" value="${esc(stripCC(st.phone))}" aria-describedby="s-err"${err ? ' aria-invalid="true"' : ''}></div></div>
      ${err ? `<p class="err-msg" id="s-err" role="alert">${te(err)}</p>` : ''}
      <button class="btn lg block" type="submit">${te('sendCode')}</button></form>
      <p class="fine">${te('agreeFine')}</p>`;
    else if (st.step === 'code') {
      const left = Math.max(0, 30 - Math.floor((Date.now() - st.sentAt) / 1000));
      b.innerHTML = `<h2>${te('codeH')}</h2><p class="msub">${th('codeP', { phone: `<b>${esc(st.phone)}</b>` })}</p>
      <div class="demo">${ic('info')}<span>${th('demoCode', { code: `<b>${st.code}</b>` })}</span></div>
      <form id="sf" novalidate><div class="field"><label for="s-code" class="sr">${te('code6')}</label><div class="inp otp${err ? ' err' : ''}"><input id="s-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-describedby="s-err"${err ? ' aria-invalid="true"' : ''}></div></div>
      ${err ? `<p class="err-msg" id="s-err" role="alert">${te(err)}</p>` : ''}
      <div class="row2"><button type="button" class="linkbtn" data-s="change">${te('changeNum')}</button><button type="button" class="linkbtn" data-s="resend"${left ? ' disabled' : ''}>${esc(resendTxt(left))}</button></div>
      <button class="btn lg block" type="submit">${te('cont')}</button></form>`;
    } else b.innerHTML = `<h2>${te('welcomeH')}</h2><p class="msub">${te('welcomeP')}</p>
      <form id="sf" novalidate><div class="field"><label for="s-name">${te('yourName')}</label><div class="inp${err === 'errName' ? ' err' : ''}"><input id="s-name" autocomplete="name" maxlength="40" placeholder="${te('namePh')}"></div></div>
      <div class="field"><label for="s-mail">${te('emailL')} <span class="hint">${te('optional')}</span></label><div class="inp${err === 'errMail' ? ' err' : ''}"><input id="s-mail" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="name@example.com"></div></div>
      ${err ? `<p class="err-msg" role="alert">${te(err)}</p>` : ''}
      <button class="btn lg block" type="submit">${te('createAcc')}</button></form>`;
    const f = b.querySelector('input'); if (f && focus) f.focus();
  };
  const send = () => { st.code = String(100000 + Math.floor(Math.random() * 900000)); st.sentAt = Date.now(); st.tries = 0; };
  const done = (u, isNew) => {
    session = { name: u.name, phone: st.phone, email: u.email || '', recvBy: u.recvBy || (u.email ? 'email' : 'phone'), recvPhone: u.recvPhone || st.phone, at: Date.now() };
    store.set(K_WEB_SESSION, session);
    orders = allOrders.filter(mine);
    closeModal();
    render();
    toast(isNew ? t('welcome', { name: u.name.split(' ')[0] }) : t('signedInAs', { name: u.name }));
    if (then) then();
  };
  modal.w.addEventListener('submit', e => {
    e.preventDefault();
    if (st.step === 'phone') {
      const raw = modal.w.querySelector('#s-phone').value; st.phone = raw;
      const p = normPhone(raw);
      if (!raw.trim()) return draw('errPhone0');
      if (!p) return draw('errPhone');
      st.phone = p; send(); st.step = 'code'; draw();
      clearInterval(tmr); tmr = setInterval(() => { const r = modal && modal.w.querySelector('[data-s="resend"]'); if (!r) return; const left = Math.max(0, 30 - Math.floor((Date.now() - st.sentAt) / 1000)); r.disabled = !!left; r.textContent = resendTxt(left); }, 1000);
    } else if (st.step === 'code') {
      const c = modal.w.querySelector('#s-code').value.replace(/\D/g, '');
      if (c.length !== 6) return draw('err6');
      if (c !== st.code) { st.tries++; return draw(st.tries >= 3 ? 'errCode3' : 'errCode'); }
      const users = store.get(K_WEB_USERS, {}) || {};
      if (users[st.phone]) done(users[st.phone], false); else { st.step = 'name'; draw(); }
    } else {
      const name = modal.w.querySelector('#s-name').value.trim(), mail = modal.w.querySelector('#s-mail').value.trim();
      if (!name) return draw('errName');
      if (mail && !EMAIL_RE.test(mail)) return draw('errMail');
      const users = store.get(K_WEB_USERS, {}) || {};
      users[st.phone] = { name, email: mail, recvBy: mail ? 'email' : 'phone', recvPhone: st.phone };
      store.set(K_WEB_USERS, users);
      done(users[st.phone], true);
    }
  });
  modal.w.addEventListener('click', e => {
    const s = e.target.closest('[data-s]'); if (!s) return;
    if (s.dataset.s === 'change') { st.step = 'phone'; draw(); }
    if (s.dataset.s === 'resend') { send(); draw(); toast(t('newCode')); }
  });
  draw();
}
function signOut() {
  session = null; store.del(K_WEB_SESSION); ui.menu = false; ui.rev.clear();
  render();
  toast(t('signedOut'));
}

/* ---------- checkout: details, then an M-Pesa payment prompt on the customer's phone (demo) ---------- */
function openCheckout() {
  if (!cart.length) { go('cart'); return; }
  if (!session) { openSignIn(openCheckout); return; }
  const st = { step: 'details', by: session.recvBy === 'email' && session.email ? 'email' : 'phone', email: session.email || '', phone: stripCC(session.recvPhone || session.phone), pay: stripCC(session.phone), agree: false, err: {}, order: null };
  let tick = null, deadline = 0;
  openModal('', { label: t('coH'), wide: true, onClose: () => clearInterval(tick) });
  const total = () => cartTotal();
  const clock = () => { const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); return t('waitAppr', { t: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }); };
  const draw = () => {
    const b = mbody(); if (!b) return;
    const lock = st.step === 'stk' || st.step === 'confirm';
    if (lock) modal.w.dataset.lock = '1'; else delete modal.w.dataset.lock;
    modal.w.querySelector('.mx').hidden = lock;
    const E = st.err;
    if (st.step === 'details') {
      const n = cartCount(), pre = cart.filter(it => isOut(it.bid, it.amount));
      b.innerHTML = `<h2>${te('coH')}</h2><p class="msub">${esc(cardsN(n))} · ${fmt(total())}</p>
        <div class="mini">${cart.map(it => `<div><span>${esc(cardName(it.bid, it.amount))} × ${it.qty}${isOut(it.bid, it.amount) ? ` · ${te('preTag')}` : ''}</span><b>${fmt(priceOf(it.amount) * it.qty)}</b></div>`).join('')}<div class="tot"><span>${te('totVat')}</span><b>${fmt(total())}</b></div></div>
        <form id="cf" novalidate>
          <div class="field"><span class="flbl" id="c-how">${te('sendBy')}</span><div class="seg" role="radiogroup" aria-labelledby="c-how"><button type="button" role="radio" aria-checked="${st.by === 'phone'}" data-by="phone">${ic('phone')}${te('sms')}</button><button type="button" role="radio" aria-checked="${st.by === 'email'}" data-by="email">${ic('mail')}${te('emailL')}</button></div></div>
          ${st.by === 'phone' ? `<div class="field"><label for="c-to">${te('smsPhone')}</label><div class="inp${E.to ? ' err' : ''}"><span class="cc">+251</span><input id="c-to" type="tel" inputmode="tel" placeholder="9X XXX XXXX" value="${esc(st.phone)}"${E.to ? ' aria-invalid="true"' : ''}></div><span class="hint">${te('giftHintP')}</span></div>`
            : `<div class="field"><label for="c-to">${te('emailAddr')}</label><div class="inp${E.to ? ' err' : ''}"><input id="c-to" type="email" autocapitalize="off" spellcheck="false" placeholder="name@example.com" value="${esc(st.email)}"${E.to ? ' aria-invalid="true"' : ''}></div><span class="hint">${te('giftHintE')}</span></div>`}
          ${E.to ? `<p class="err-msg" role="alert">${te(E.to)}</p>` : ''}
          <div class="field"><label for="c-pay">${te('payNum')}</label><div class="inp${E.pay ? ' err' : ''}"><span class="cc">+251</span><input id="c-pay" type="tel" inputmode="tel" placeholder="9X XXX XXXX" value="${esc(st.pay)}"${E.pay ? ' aria-invalid="true"' : ''}></div><span class="hint">${te('payHint')}</span></div>
          ${E.pay ? `<p class="err-msg" role="alert">${te(E.pay)}</p>` : ''}
          ${pre.length ? `<div class="demo">${ic('clock')}<span>${te(pre.length === cart.length ? 'preNoteAll' : 'preNoteSome', { date: dmy(Math.max(...pre.map(it => etaOf(it.bid, it.amount)))) })}</span></div>` : ''}
          <label class="check"><input type="checkbox" id="c-agree"${st.agree ? ' checked' : ''}><span>${te('agreeChk')}</span></label>
          ${E.agree ? `<p class="err-msg" role="alert">${te(E.agree)}</p>` : ''}
          <button class="btn lg block" type="submit">${ic('wallet')}${te('payBtn', { amount: fmt(total()) })}</button>
        </form>`;
    } else if (st.step === 'stk') {
      b.innerHTML = `<div class="stk"><div class="phone-ic">${ic('phone')}</div><h2>${te('stkH')}</h2>
        <p>${th('stkP', { amount: `<b>${fmt(total())}</b>`, phone: `<b>${esc(normPhone(st.pay))}</b>` })}</p>
        <p class="timer" id="c-timer">${esc(clock())}</p>
        <div class="demo">${ic('info')}<span>${te('stkDemo')}</span></div>
        <div class="btns"><button class="btn line" data-c="decline">${te('decline')}</button><button class="btn" data-c="approve">${ic('check')}${te('approve')}</button></div>
        <p class="fine"><button class="linkbtn" data-c="cancel">${te('cancelPay')}</button></p></div>`;
    } else if (st.step === 'confirm') {
      b.innerHTML = `<div class="stk"><div class="spin" role="img" aria-label="${te('confirming')}"></div><h2>${te('confH')}</h2><p>${te('confP')}</p></div>`;
    } else if (st.step === 'done') {
      const o = st.order, allWait = o.items.every(it => it.status === 'waiting');
      const sendKey = o.smsTo ? (allWait ? 'sendSmsLater' : 'sendSms') : (allWait ? 'sendMailLater' : 'sendMail');
      b.innerHTML = `<div class="stk"><div class="done-ic">${ic('check')}</div><h2>${te('doneH')}</h2><p>${th('orderL', { id: `<b>${esc(o.id)}</b>`, amount: fmt(o.total) })}</p></div>
        <div class="dlist">${o.items.map((it, i) => `<div class="ditem"><b><span>${esc(cardName(it.bid, it.amount))} × ${it.qty}</span>${it.status === 'waiting' ? `<span class="st pre">${ic('clock')}${te('expBy', { date: dmy(it.eta) })}</span>` : `<span class="st ok">${ic('check')}${te('stDelivered')}</span>`}</b>${it.status === 'waiting' ? '' : `<div class="codes">${codesHTML(o, i, it)}</div>`}</div>`).join('')}</div>
        <p class="hint" style="text-align:center;margin:0 0 16px">${te(sendKey, { to: o.smsTo || o.email })} ${te('demoNothing')}</p>
        <div class="btns"><button class="btn line" data-c="shop">${te('keepShop')}</button><button class="btn" data-c="orders">${te('viewOrders')}</button></div>`;
    } else {
      const k = st.step === 'declined' ? 'decl' : st.step === 'expired' ? 'exp' : 'canc';
      b.innerHTML = `<div class="stk"><div class="done-ic bad">${ic('close')}</div><h2>${te(k + 'H')}</h2>
        <p>${te(k + 'P')} ${te('notCharged')}</p></div>
        <div class="btns" style="margin-top:20px"><button class="btn line" data-c="close">${te('backCart')}</button><button class="btn" data-c="retry">${te('tryAgain')}</button></div>`;
    }
  };
  const read = () => {
    const to = modal.w.querySelector('#c-to'), pay = modal.w.querySelector('#c-pay'), ag = modal.w.querySelector('#c-agree');
    if (to) { if (st.by === 'phone') st.phone = to.value; else st.email = to.value; }
    if (pay) st.pay = pay.value;
    if (ag) st.agree = ag.checked;
  };
  modal.w.addEventListener('submit', e => {
    e.preventDefault(); read(); st.err = {};
    const to = st.by === 'phone' ? normPhone(st.phone) : st.email.trim();
    if (st.by === 'phone' && !to) st.err.to = st.phone.trim() ? 'errToSms' : 'errTo0Sms';
    if (st.by === 'email' && !EMAIL_RE.test(to)) st.err.to = to ? 'errToMail' : 'errTo0Mail';
    if (!normPhone(st.pay)) st.err.pay = 'errPay';
    if (!st.agree) st.err.agree = 'errAgree';
    if (Object.keys(st.err).length) { draw(); const f = modal.w.querySelector('[aria-invalid="true"]'); if (f) f.focus(); return; }
    session.recvBy = st.by; if (st.by === 'phone') session.recvPhone = to; else session.email = to;
    store.set(K_WEB_SESSION, session);
    const users = store.get(K_WEB_USERS, {}) || {};
    if (users[session.phone]) { Object.assign(users[session.phone], { recvBy: st.by, recvPhone: session.recvPhone, email: session.email }); store.set(K_WEB_USERS, users); }
    st.to = to; st.step = 'stk'; deadline = Date.now() + 90000; draw();
    clearInterval(tick); tick = setInterval(() => {
      const el = modal && modal.w.querySelector('#c-timer');
      if (el) el.textContent = clock();
      if (Date.now() >= deadline && st.step === 'stk') { clearInterval(tick); st.step = 'expired'; draw(); }
    }, 1000);
  });
  modal.w.addEventListener('click', e => {
    const by = e.target.closest('[data-by]');
    if (by) { read(); st.by = by.dataset.by; st.err = {}; draw(); const f = modal.w.querySelector('#c-to'); if (f) f.focus(); return; }
    const c = e.target.closest('[data-c]'); if (!c) return;
    const k = c.dataset.c;
    if (k === 'approve') { clearInterval(tick); st.step = 'confirm'; draw(); setTimeout(() => { st.order = placeOrder(st.by, st.to, normPhone(st.pay)); st.step = 'done'; draw(); drawHeader(); if (route.p === 'cart') renderMain(); }, 1400); }
    else if (k === 'decline') { clearInterval(tick); st.step = 'declined'; draw(); }
    else if (k === 'cancel') { clearInterval(tick); st.step = 'cancelled'; draw(); }
    else if (k === 'retry') { st.step = 'details'; draw(); }
    else if (k === 'close') { closeModal(); }
    else if (k === 'shop') { closeModal(); go('all'); }
    else if (k === 'orders') { closeModal(); go('orders'); }
  });
  draw();
}
function placeOrder(by, to, payPhone) {
  loadShared();   // latest stock, prices and orders, in case they changed in the admin panel
  const items = [], now = Date.now(), oid = 'EC' + String(Math.floor(10000000 + Math.random() * 89999999));
  let apiUsed = false;
  cart.forEach(it => {   // own stock first, then the gift card provider; anything left becomes a pre-order
    const k = skey(it.bid, it.amount), x = stock[k] || (stock[k] = { qty: 0, eta: null, codes: [] });
    const unit = priceOf(it.amount), n = Math.max(0, Math.min(it.qty, x.qty));
    if (n) { x.qty -= n; items.push({ ...it, qty: n, unit, codes: takeCodes(x, n), status: 'delivered', deliveredAt: now }); }
    let rest = it.qty - n;
    if (rest && apiFor(api, it.bid, it.amount)) {   // demo: in the live system the server places this order after M-Pesa confirms the payment
      apiUsed = true;
      const got = apiBuy(api, { ...it, qty: rest }, `${oid}-${items.length + 1}`, 'web');
      if (got) { items.push({ ...it, qty: rest, unit, codes: got.codes, status: 'delivered', deliveredAt: now, via: got.via }); rest = 0; }
    }
    if (rest) items.push({ ...it, qty: rest, unit, codes: [], status: 'waiting', eta: etaOf(it.bid, it.amount) });
  });
  if (apiUsed) saveApi(api);
  const order = {
    id: oid, at: now, channel: 'web',
    name: session.name, phone: session.phone, payPhone,
    deliverBy: by, email: by === 'email' ? to : '', smsTo: by === 'phone' ? to : '',
    total: items.reduce((x, it) => x + it.unit * it.qty, 0),
    items
  };
  allOrders.unshift(order);
  saveStock(); saveOrders();
  cart = []; saveCart();
  return order;
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const tg = e.target, g = s => tg.closest(s);
  let x;
  if ((ui.menu || ui.langMenu) && !g('.acct-wrap')) { ui.menu = false; ui.langMenu = false; drawHeader(); }
  if ((x = g('a[data-go]'))) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button > 0) return;   // new tab or window: let the browser follow the link
    e.preventDefault();
    const p = x.dataset.go, q = x.dataset.q || '', v = x.dataset.v ? +x.dataset.v : null, hash = x.dataset.hash, l = x.dataset.langTo;
    if (l) { store.set(K_LANG, l); go(p, q, { v, lang: l, keepScroll: true, keepFocus: true }); return; }
    const same = p === route.p && q === route.q;
    if (hash) { if (p === route.p && p !== 'brand') { const el = document.getElementById(hash); if (el) el.scrollIntoView({ behavior: 'smooth' }); return; } go(p, q, { scroll: hash }); return; }
    if (p === 'all' && route.p !== 'all') ui.q = '';
    if (p === 'brand' && (q !== route.q || v !== route.v)) ui.qty = 1;
    go(p, q, { v, keepScroll: same && p === 'brand' });
    if (x.dataset.focus) { const f = document.getElementById(x.dataset.focus); if (f) f.focus(); }
    return;
  }
  if ((x = g('[data-cat]'))) { ui.cat = x.dataset.cat; renderMain(); return; }
  if ((x = g('[data-act]'))) {
    const a = x.dataset.act;
    if (a === 'menu') { ui.menu = !ui.menu; ui.langMenu = false; drawHeader(); if (ui.menu) { const m = document.querySelector('.menu a, .menu button'); if (m) m.focus(); } }
    else if (a === 'lang') { ui.langMenu = !ui.langMenu; ui.menu = false; drawHeader(); if (ui.langMenu) { const m = document.querySelector('.lmenu [aria-checked="true"]'); if (m) m.focus(); } }
    else if (a === 'signin') openSignIn(route.p === 'orders' ? () => render() : null);
    else if (a === 'signout') signOut();
    else if (a === 'clear') { ui.q = ''; const h = document.getElementById('hq'); if (h) h.value = ''; go('all', '', { replace: true, keepFocus: true }); }
    else if (a === 'add') { if (addToCart(x.dataset.bid, +x.dataset.v, ui.qty)) toast(t('added', { n: ui.qty, name: cardName(x.dataset.bid, +x.dataset.v) })); }
    else if (a === 'buynow') { if (addToCart(x.dataset.bid, +x.dataset.v, ui.qty) || cart.some(it => it.bid === x.dataset.bid && it.amount === +x.dataset.v)) { go('cart'); openCheckout(); } }
    else if (a === 'checkout') openCheckout();
    return;
  }
  if ((x = g('[data-qty]'))) { ui.qty = Math.max(1, ui.qty + +x.dataset.qty); renderMain(); const n = document.querySelector(`[data-qty="${x.dataset.qty}"]`); if (n && !n.disabled) n.focus(); return; }
  if ((x = g('[data-cq]'))) { const [i, d] = x.dataset.cq.split('|').map(Number); const it = cart[i]; if (!it) return; it.qty = Math.max(1, it.qty + d); saveCart(); renderMain(); const n = document.querySelector(`[data-cq="${x.dataset.cq}"]`); if (n && !n.disabled) n.focus(); return; }
  if ((x = g('[data-rm]'))) { const it = cart[+x.dataset.rm]; cart.splice(+x.dataset.rm, 1); saveCart(); renderMain(); if (it) toast(t('removed', { name: cardName(it.bid, it.amount) })); return; }
  if ((x = g('[data-rev]'))) {
    const k = x.dataset.rev; if (ui.rev.has(k)) ui.rev.delete(k); else ui.rev.add(k);
    const [oid, i, ci] = k.split('-'), o = allOrders.find(y => y.id === oid), wrap = x.closest('.code');
    if (o && wrap) { const c = o.items[+i].codes[+ci], vis = ui.rev.has(k); wrap.querySelector('span').textContent = vis ? c : maskCode(c); x.innerHTML = ic(vis ? 'eyeOff' : 'eye'); x.setAttribute('aria-pressed', String(vis)); x.setAttribute('aria-label', vis ? t('hideCode') : t('showCode')); }
    return;
  }
  if ((x = g('[data-copy]'))) { const c = x.dataset.copy; (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(() => toast(t('codeCopied')), () => toast(t('copyNA'))); return; }
});
document.addEventListener('submit', e => {
  if (!e.target.matches('[data-search]')) return;
  e.preventDefault();
  const v = e.target.querySelector('input').value; ui.q = v;
  if (route.p !== 'all') ui.cat = 'all';
  go('all', route.p === 'all' ? route.q : '', { keepFocus: true, replace: route.p === 'all' });
});
let qTimer = null;
document.addEventListener('input', e => {
  const tg = e.target;
  if (tg.id === 'hq' || tg.id === 'cq') {
    ui.q = tg.value;
    const other = document.getElementById(tg.id === 'hq' ? 'cq' : 'hq'); if (other) other.value = ui.q;
    if (route.p !== 'all') { go('all', '', { keepFocus: true }); const f = document.getElementById(tg.id); if (f) { f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch (er) { /* search */ } } return; }
    clearTimeout(qTimer); qTimer = setTimeout(() => {
      const gEl = document.getElementById('cgrid'); if (gEl) gEl.innerHTML = gridHTML();
      if (PATH_MODE && LINKED) { try { history.replaceState(null, '', pathOf('all', route.q) + (ui.q ? '?q=' + encodeURIComponent(ui.q) : '')); } catch (er) { /* preview */ } }
      applySEO();
    }, 150);
  }
});
document.addEventListener('change', e => { if (e.target.id === 'sort') { ui.sort = e.target.value; document.getElementById('cgrid').innerHTML = gridHTML(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (ui.menu || ui.langMenu)) { ui.menu = false; ui.langMenu = false; drawHeader(); } });

/* ---------- live updates from the admin panel and the mini app ---------- */
window.addEventListener('storage', e => {
  if (e.key === K_LANG) return;   // the address decides the language of this page
  if (e.key && ![K_CONFIG, K_STOCK, K_ORDERS, K_API, K_MEDIA, K_WEB_SESSION].includes(e.key)) return;
  const before = new Set(myOrders().flatMap(o => o.items.map((it, i) => it.status === 'waiting' ? `${o.id}-${i}` : null)).filter(Boolean));
  if (e.key === K_WEB_SESSION || e.key === null) session = store.get(K_WEB_SESSION, null);
  loadShared(); loadMedia();
  const n = cart.length; cart = cart.filter(it => live(BR[it.bid]) && BR[it.bid].amounts.includes(it.amount)); if (cart.length !== n) store.set(K_WEB_CART, cart);
  const arrived = myOrders().some(o => o.items.some((it, i) => before.has(`${o.id}-${i}`) && it.status === 'delivered'));
  if (modal) { drawHeader(); } else {
    const ae = document.activeElement;
    if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) drawHeaderSafe(); else render();
  }
  drawFooter();
  if (arrived) toast(t('arrived'));
});
function drawHeaderSafe() { const ae = document.activeElement; if (ae && ae.closest('#top')) return; drawHeader(); }

/* ---------- start ---------- */
if (!metaContent('ec-og')) {
  applyRoute(readLocation());
  render();
  drawFooter();
  if (!LINKED && !metaContent('ec-build')) toast(t('previewNote'));
  probeAssets().then(() => { loadMedia(); if (['logos', 'cards', 'banners'].some(k => Object.keys(FOUND[k]).length)) { render(); drawFooter(); } });
}

})();
