// GoNow! UI. Contains no market constants: everything comes from js/markets/*.
import { MARKETS, DEFAULT_MARKET, getMarket, marketAt } from './markets/index.js';
import { estimateAll, sortResults, anyEtaSourced } from './engine.js';
import { searchPlaces, reverseGeocode, route } from './geo.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── persistence ─────────────────────────────────────────────────────────────
const store = {
  get(k, d) { try { const v = localStorage.getItem('gonow.v1.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gonow.v1.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ── state ───────────────────────────────────────────────────────────────────
const state = {
  market: getMarket(store.get('market', DEFAULT_MARKET.id)),
  from: null, to: null,
  locating: false,
  payment: null,
  sort: 'cheapest',
  whenISO: null,       // null = leave now
  whenOpen: false,
  editSaved: false,
  trip: null,          // routed trip
  status: 'idle',      // idle | loading | ready | error
  expanded: new Set(),
  saved: store.get('saved', {}),     // { home, work }
  recents: store.get('recents', []),
  runId: 0,
};
state.payment = store.get('payment', state.market.defaultPayment);
if (!state.market.paymentMethods.some((p) => p.id === state.payment)) state.payment = state.market.defaultPayment;

const fmt = (n) => state.market.currency.symbol + n.toFixed(state.market.currency.decimals);
const fmtWhole = (n) => state.market.currency.symbol + Math.round(n);
const ICON = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-6.5 8 6.5M6 10v9h12v-9"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>',
  locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// ── toast ───────────────────────────────────────────────────────────────────
let toastT;
function toast(msg, ms = 3600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
function hideToast() {
  const t = $('#toast');
  if (t) t.classList.remove('show');
  clearTimeout(toastT);
}

// ── views ───────────────────────────────────────────────────────────────────
function showView(id) {
  for (const v of document.querySelectorAll('.view')) {
    const on = v.id === id;
    if (on && !v.classList.contains('is-active')) { v.classList.remove('is-leaving'); v.classList.add('is-active'); }
    if (!on) v.classList.remove('is-active', 'is-leaving');
  }
  window.scrollTo({ top: 0 });
  if (id === 'home') history.replaceState(null, '', location.pathname);
}

// ── HOME ────────────────────────────────────────────────────────────────────
function stopRow(field, label, place, extra = '') {
  const txt = place
    ? `<b>${esc(place.title)}</b>`
    : (field === 'from' && state.locating)
      ? `<b class="skeleton loc-shimmer" aria-label="Locating"></b>`
      : `<b class="placeholder">${field === 'from' ? 'Where from?' : 'Search a place'}</b>`;
  return `<button class="stop" data-field="${field}" aria-label="${label}">
      <span class="dot ${field === 'to' ? 'to' : ''}"></span>
      <span class="stop-text"><small>${label}</small>${txt}</span>${extra}
    </button>`;
}

function whenLabel() {
  if (!state.whenISO) return 'Now';
  const d = new Date(state.whenISO);
  return new Intl.DateTimeFormat(state.market.locale, { timeZone: state.market.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
}

function renderHome() {
  const m = state.market;
  const saved = ['home', 'work'].map((k) => {
    const p = state.saved[k];
    const name = k === 'home' ? 'Home' : 'Work';
    if (p && !state.editSaved) return `<button class="chip" data-saved="${k}">${name}</button>`;
    if (p && state.editSaved) return `<button class="chip editing" data-saved-edit="${k}">${name} · change</button>`;
    return `<button class="chip empty" data-saved-edit="${k}">+ Set ${name}</button>`;
  }).join('');
  const quick = m.quickPlaces.map((q) => `
    <button class="row" data-quick="${q.id}">
      <span class="row-ico">${ICON.pin}</span>
      <span class="row-text"><b>${esc(q.title)}</b><span>${esc(q.sub)}</span></span>
    </button>`).join('');
  const recents = state.recents.slice(0, 4).map((r, i) => `
    <button class="row" data-recent="${i}">
      <span class="row-ico">${ICON.clock}</span>
      <span class="row-text"><b>${esc(r.title)}</b><span>${esc(r.sub || '')}</span></span>
    </button>`).join('');

  $('#home').innerHTML = `
    <div class="hero">
      <h1>Where to?</h1>
      <p>Every ride app, one honest price.</p>
    </div>
    <div class="route">
      ${stopRow('from', 'From', state.from)}
      ${stopRow('to', 'To', state.to, '')}
      <button class="swap" id="swap" aria-label="Swap pick-up and destination">${ICON.swap}</button>
    </div>
    <div class="when">
      <span>Leave</span>
      <button id="whenBtn">${esc(whenLabel())}</button>
      ${state.whenOpen ? `<input id="whenInput" type="datetime-local" value="${esc(toLocalInput(state.whenISO))}" aria-label="Leave at"><button id="whenNow">Now</button>` : ''}
    </div>
    <div class="eyebrow"><span>Saved</span><button id="editSaved">${state.editSaved ? 'Done' : 'Edit'}</button></div>
    <div class="chips">${saved}</div>
    ${recents ? `<div class="eyebrow"><span>Recent</span></div><div class="list">${recents}</div>` : ''}
    <div class="eyebrow"><span>Popular in ${esc(m.name)}</span></div>
    <div class="list">${quick}</div>
    <p class="foot-note">${esc(m.disclaimer)}</p>`;
}

function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  // datetime-local expects the user's local clock; we show the browser-local time.
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── PICKER ──────────────────────────────────────────────────────────────────
let pickerCtx = null;
let searchAbort = null;
let searchTimer = null;

function openPicker(field, role = null) {
  pickerCtx = { field, role };
  const el = $('#picker');
  const title = role ? `Set ${role === 'home' ? 'Home' : 'Work'}` : field === 'from' ? 'Search pick-up' : 'Search destination';
  el.innerHTML = `
    <div class="picker-top">
      <button class="icon-btn" id="pkBack" aria-label="Close">${ICON.back}</button>
      <label class="picker-input">${ICON.search}<input id="pkInput" type="search" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(title)}" aria-label="${esc(title)}"></label>
    </div>
    <div class="picker-body" id="pkBody"></div>`;
  el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
  renderPickerIdle();
  setTimeout(() => $('#pkInput')?.focus(), 60);
}
function closePicker() {
  const el = $('#picker');
  el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
  if (searchAbort) searchAbort.abort();
  clearTimeout(searchTimer);
  pickerCtx = null;
}
function placeRows(list, kind) {
  return list.map((p, i) => `
    <button class="row" data-pick="${kind}:${i}">
      <span class="row-ico">${kind === 'recent' ? ICON.clock : kind === 'saved' ? ICON.home : ICON.pin}</span>
      <span class="row-text"><b>${esc(p.title)}</b><span>${esc(p.sub || '')}</span></span>
    </button>`).join('');
}
let pickerLists = {};
function renderPickerIdle() {
  const m = state.market;
  const body = $('#pkBody');
  pickerLists = {
    locate: [], saved: [], recent: state.recents.slice(0, 5),
    quick: m.quickPlaces.map((q) => ({ title: q.title, sub: q.sub, lat: q.lat, lon: q.lon })),
  };
  const savedList = ['home', 'work'].filter((k) => state.saved[k]).map((k) => ({ ...state.saved[k], sub: (k === 'home' ? 'Home' : 'Work'), _k: k }));
  pickerLists.saved = savedList;
  const locate = pickerCtx.field === 'from' && !pickerCtx.role
    ? `<button class="row" data-locate="1"><span class="row-ico">${ICON.locate}</span><span class="row-text"><b>Use current location</b><span>Via your browser</span></span></button>` : '';
  body.innerHTML = `${locate}
    ${savedList.length && !pickerCtx.role ? `<div class="picker-label">Saved</div><div class="list">${placeRows(savedList, 'saved')}</div>` : ''}
    ${pickerLists.recent.length && !pickerCtx.role ? `<div class="picker-label">Recent</div><div class="list">${placeRows(pickerLists.recent, 'recent')}</div>` : ''}
    <div class="picker-label">Popular</div><div class="list">${placeRows(pickerLists.quick, 'quick')}</div>`;
}
function onPickerInput(q) {
  clearTimeout(searchTimer);
  if (searchAbort) searchAbort.abort();
  const body = $('#pkBody');
  q = q.trim();
  if (q.length < 2) { renderPickerIdle(); return; }
  body.innerHTML = `<div class="picker-msg">Searching…</div>`;
  searchTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    const mine = searchAbort;
    try {
      const { results } = await searchPlaces(state.market, q, mine.signal);
      if (mine.signal.aborted) return;
      pickerLists.results = results;
      body.innerHTML = results.length
        ? `<div class="list">${placeRows(results, 'results')}</div>`
        : `<div class="picker-msg">No matches in ${esc(state.market.name)}. Try a postal code or building name.</div>`;
    } catch (e) {
      if (mine.signal.aborted) return;
      // graceful fallback: local filter of popular places
      const ql = q.toLowerCase();
      const local = state.market.quickPlaces.filter((p) => (p.title + ' ' + p.sub).toLowerCase().includes(ql))
        .map((p) => ({ title: p.title, sub: p.sub, lat: p.lat, lon: p.lon }));
      pickerLists.results = local;
      body.innerHTML = `<div class="picker-msg">Search is unavailable right now.${local.length ? ' Showing matching popular places.' : ' Pick from popular places instead.'}</div>` +
        (local.length ? `<div class="list">${placeRows(local, 'results')}</div>` : '');
    }
  }, 220);
}

function choosePlace(p) {
  const ctx = pickerCtx;
  closePicker();
  if (!ctx) return;
  const place = { title: p.title, sub: p.sub || '', lat: p.lat, lon: p.lon };
  if (ctx.role) {
    state.saved[ctx.role] = place; store.set('saved', state.saved);
    state.editSaved = false; renderHome();
    toast(`${ctx.role === 'home' ? 'Home' : 'Work'} saved on this device`);
    return;
  }
  setPlace(ctx.field, place);
}

function setPlace(field, place) {
  state[field] = place;
  if (field === 'to') {
    state.recents = [place, ...state.recents.filter((r) => r.title !== place.title)].slice(0, 6);
    store.set('recents', state.recents);
  }
  const m = marketAt(place.lat, place.lon);
  if (m && m.id !== state.market.id) { state.market = m; store.set('market', m.id); }
  renderHome();
  maybeCompare();
}

// ── location ────────────────────────────────────────────────────────────────
function locate({ silent = false } = {}) {
  if (!('geolocation' in navigator)) { if (!silent) toast('Location isn’t available in this browser. Type a pick-up.'); return; }
  state.locating = true; renderHome();
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    const m = marketAt(lat, lon);
    if (!m) {
      state.locating = false; renderHome();
      toast(`You’re outside ${MARKETS.map((x) => x.name).join(' / ')}. Search a pick-up instead.`, 4500);
      return;
    }
    if (m.id !== state.market.id) { state.market = m; store.set('market', m.id); }
    const name = await reverseGeocode(state.market, lat, lon);
    state.locating = false;
    state.from = { title: name.title, sub: name.sub, lat, lon, gps: true };
    renderHome(); maybeCompare();
  }, (err) => {
    state.locating = false; renderHome();
    if (!silent) toast(err.code === 1 ? 'Location is off. Type your pick-up instead.' : 'Couldn’t get your location. Type it instead.');
  }, { enableHighAccuracy: false, timeout: 9000, maximumAge: 60000 });
}

// ── COMPARE ─────────────────────────────────────────────────────────────────
function maybeCompare() {
  if (state.from && state.to) startCompare();
  else if (state.to && !state.from) { toast('Where are you starting from?'); openPicker('from'); }
}

function whenDate() { return state.whenISO ? new Date(state.whenISO) : new Date(); }

async function startCompare() {
  const run = ++state.runId;
  state.status = 'loading'; state.trip = null; state.expanded.clear();
  buildResultsShell();
  showView('results');
  try {
    const r = await route(state.market, state.from, state.to);
    if (run !== state.runId) return;
    state.trip = {
      from: state.from, to: state.to,
      distanceKm: r.distanceKm, durationMin: r.durationMin,
      geometry: r.geometry, routeSource: r.source,
    };
    state.status = 'ready';
  } catch (e) {
    if (run !== state.runId) return;
    state.status = 'error';
  }
  updateResults({ enter: true });
}

function buildResultsShell() {
  const m = state.market;
  const idx = Math.max(0, m.paymentMethods.findIndex((p) => p.id === state.payment));
  $('#results').innerHTML = `
    <div class="rhead">
      <button class="icon-btn" id="rBack" aria-label="Back">${ICON.back}</button>
      <div class="rtitle"><b id="rTitle">${esc(state.from.title)} → ${esc(state.to.title)}</b><span id="rMeta">Finding the road…</span></div>
    </div>
    <div class="controls">
      <div class="seg" id="segPay" role="group" aria-label="Payment method" style="--n:${m.paymentMethods.length};--i:${idx}">
        <span class="seg-thumb"></span>
        ${m.paymentMethods.map((p) => `<button data-pay="${p.id}" aria-pressed="${p.id === state.payment}">${esc(p.label)}</button>`).join('')}
      </div>
      <div class="seg" id="segSort" role="group" aria-label="Sort" style="--n:2;--i:${state.sort === 'fastest' ? 1 : 0}">
        <span class="seg-thumb"></span>
        <button data-sort="cheapest" aria-pressed="${state.sort === 'cheapest'}">Cheapest</button>
        <button data-sort="fastest" aria-pressed="${state.sort === 'fastest'}" ${anyEtaSourced(m) ? '' : 'disabled title="Needs live wait times from providers"'}>Fastest</button>
      </div>
      ${anyEtaSourced(m) ? '' : '<p class="sort-hint">Fastest unlocks when a provider shares live wait times.</p>'}
    </div>
    <div id="summary" class="summary"></div>
    <div id="cards" class="cards"><div class="skeleton card"></div><div class="skeleton card"></div><div class="skeleton card"></div></div>
    <div id="below"></div>`;
}

function updateResults({ enter = false } = {}) {
  const m = state.market;
  const cards = $('#cards'), summary = $('#summary'), meta = $('#rMeta'), below = $('#below');
  if (!cards) return;
  if (state.status === 'error' || !state.trip) {
    cards.innerHTML = `<div class="errbox">Couldn’t work out a route for this trip.<br><button id="retry">Try again</button></div>`;
    summary.innerHTML = ''; meta.textContent = 'Route unavailable'; below.innerHTML = '';
    return;
  }
  const when = whenDate();
  const out = estimateAll(m, state.trip, { when, payment: state.payment });
  const sorted = sortResults(out.results, state.sort);
  const cheapest = [...out.results].sort((a, b) => a.total - b.total)[0];
  const priciest = [...out.results].sort((a, b) => b.total - a.total)[0];
  const t = out.trip;
  const bandName = out.band.late ? 'late night' : out.band.peak ? 'peak' : 'off-peak';
  meta.innerHTML = `<span class="num">${t.distanceKm.toFixed(1)} km</span> · <span class="num">${Math.round(t.durationMin)} min</span> · ${esc(whenLabel() === 'Now' ? 'Now' : whenLabel())} · ${bandName}${t.routeSource === 'estimate' ? ' · straight-line estimate' : ''}`;
  summary.innerHTML = `<span><b>${esc(cheapest.provider.name)}</b> is cheapest at <b class="num">${fmt(cheapest.total)}</b>. Spread across apps: <span class="num">${fmt(priciest.total - cheapest.total)}</span>.</span>`;

  cards.className = 'cards' + (enter ? ' enter' : '');
  cards.innerHTML = sorted.map((r, i) => cardHtml(r, r === cheapest, i)).join('');
  below.innerHTML = `
    <div class="notice"><b>How to read this.</b> ${esc(m.modelNotice)}${t.routeSource === 'estimate' ? ' The road route could not be fetched, so distance and time are straight-line estimates and ranges are wider.' : ''}</div>
    <p class="disclaimer">${esc(m.disclaimer)}</p>`;
}

function cardHtml(r, best, i) {
  const p = r.provider;
  const open = state.expanded.has(p.id);
  const prefilled = p.handoff.prefill === 'documented';
  const lines = r.items.map((it) => `
    <div class="line"><span>${esc(it.label)}${it.note ? `<small>${esc(it.note)}</small>` : ''}</span><span class="num">${fmt(it.amount)}</span></div>`).join('');
  const verify = r.feesNeedVerification ? ' Some fees come from a secondary source and still need checking.' : '';
  const notes = [...r.notes];
  return `
  <article class="pc ${best ? 'best' : ''}" data-id="${esc(p.id)}" style="--d:${i}">
    <button class="pc-main" data-toggle="${esc(p.id)}" aria-expanded="${open}" aria-label="${esc(p.name)} price breakdown">
      <span class="mono">${esc(p.monogram)}</span>
      <span class="pc-name"><b>${esc(p.name)}</b><span>${esc(p.service)} · ${p.seats} seats</span></span>
      <span class="pc-price"><b class="num">${fmt(r.total)}</b><span class="num">${fmtWhole(r.low)}–${fmtWhole(r.high)}</span></span>
    </button>
    <div class="pc-tags">
      <span class="tag ${r.label === 'Tariff' ? 'tariff' : ''}" title="${r.label === 'Tariff' ? 'Calculated from the published tariff' : 'Placeholder model, not a provider quote'}">${esc(r.label)}</span>
      ${best ? '<span class="tag best">Cheapest</span>' : ''}
      <button class="link-btn" data-toggle="${esc(p.id)}" aria-expanded="${open}">Breakdown ${ICON.chev}</button>
    </div>
    <div class="detail ${open ? 'open' : ''}"><div>
      <div class="lines">${lines}
        <div class="line total"><span>All-in estimate</span><span class="num">${fmt(r.total)}</span></div>
      </div>
      <p class="pc-notes">${[...notes, 'Not included: promos, tolls, tips, live surge.' + verify].map(esc).join(' ')}</p>
    </div></div>
    <div class="pc-foot">
      <small class="${prefilled ? 'ok' : ''}">${prefilled ? 'Tries to prefill trip' : 'Opens app'}</small>
      <button class="go" data-go="${esc(p.id)}">${esc(p.handoff.action)} ${ICON.out}</button>
    </div>
  </article>`;
}

// ── HAND-OFF (never books; only opens the provider) ─────────────────────────
function platform() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}
function handoff(id) {
  const p = state.market.providers.find((x) => x.id === id);
  if (!p || !state.trip) return;
  if (p.handoff.prefill === 'documented') {
    toast(`Opening ${p.name} with your trip. Nothing is booked until you confirm there.`, 4500);
    navigateToProvider(p, { delay: 450 });
    return;
  }
  openHandoffSheet(p);
}

function navigateToProvider(p, { delay = 0 } = {}) {
  const links = p.handoff.links(state.trip);
  const plat = platform();
  const go = (url) => { if (plat === 'desktop') window.open(url, '_blank', 'noopener'); else window.location.href = url; };
  const launch = () => {
    if (links.universal) return go(links.universal);
    if (plat === 'desktop') return go(links.web);
    if (links.scheme) {
      window.location.href = links.scheme;
      setTimeout(() => { if (document.visibilityState === 'visible') window.location.href = links[plat] || links.web; }, 1600);
      return;
    }
    go(links[plat] || links.web);
  };
  if (delay) setTimeout(launch, delay);
  else launch();
}

// ── handoff sheet (providers without a documented prefill link) ─────────────
let handoffProvider = null;
let handoffCopyState = 'idle'; // idle | to | from | fail

function copyText(text) {
  const value = String(text ?? '');
  let ok = false;
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(ta);
  const sel = document.getSelection();
  const saved = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  if (saved && sel) { sel.removeAllRanges(); sel.addRange(saved); }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try { navigator.clipboard.writeText(value); } catch { /* private mode / denied */ }
  }
  return ok;
}

function copyStatusLabel(kind) {
  if (kind === 'to') return 'Destination copied';
  if (kind === 'from') return 'Pickup copied';
  if (kind === 'fail') return 'Couldn’t copy. Enter it in the app.';
  return 'Copy destination';
}

function setCopyState(kind) {
  handoffCopyState = kind;
  const s = $('#handoffStatus');
  if (!s) return;
  s.className = 'sheet-status' + (kind === 'fail' ? ' err' : kind === 'idle' ? '' : ' ok');
  s.textContent = copyStatusLabel(kind);
}

function fareFor(id) {
  if (!state.trip) return null;
  const out = estimateAll(state.market, state.trip, { when: whenDate(), payment: state.payment });
  return out.results.find((r) => r.provider.id === id) || null;
}

function renderHandoffSheet() {
  const p = handoffProvider;
  const el = $('#handoff');
  if (!p || !el) return;
  const from = state.from || state.trip.from;
  const to = state.to || state.trip.to;
  const fare = fareFor(p.id);
  const fareHtml = fare ? `
    <div class="sheet-fare">
      <div class="sheet-fare-label"><small>${esc(fare.label)} estimate</small><span>${esc(p.service)}</span></div>
      <div class="sheet-fare-amt"><b class="num">${fmt(fare.total)}</b><span class="num">${fmtWhole(fare.low)}–${fmtWhole(fare.high)}</span></div>
    </div>` : '';
  const statusClass = handoffCopyState === 'fail' ? ' err' : handoffCopyState === 'idle' ? '' : ' ok';
  el.innerHTML = `
    <div class="sheet-backdrop" data-handoff-close></div>
    <div class="sheet-panel" role="document">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 id="handoffTitle">${esc(p.handoff.action)}</h2>
        <button type="button" class="icon-btn" data-handoff-close aria-label="Close">${ICON.close}</button>
      </div>
      ${fareHtml}
      <div class="sheet-stops">
        <div class="sheet-stop">
          <span class="dot"></span>
          <span class="stop-text"><small>Pickup</small><b>${esc(from.title)}</b>${from.sub ? `<span>${esc(from.sub)}</span>` : ''}</span>
        </div>
        <div class="sheet-stop">
          <span class="dot to"></span>
          <span class="stop-text"><small>Destination</small><b>${esc(to.title)}</b>${to.sub ? `<span>${esc(to.sub)}</span>` : ''}</span>
        </div>
      </div>
      <p class="sheet-note">${esc(p.name)} doesn’t let other apps fill in your trip, so paste the destination when it opens.</p>
      <p id="handoffStatus" class="sheet-status${statusClass}" role="status">${esc(copyStatusLabel(handoffCopyState))}</p>
      <button type="button" class="sheet-primary" data-handoff-open>Copy destination &amp; open ${esc(p.name)} ${ICON.out}</button>
      <button type="button" class="sheet-secondary" data-handoff-copy-from>Copy pickup</button>
    </div>`;
}

function openHandoffSheet(p) {
  handoffProvider = p;
  handoffCopyState = 'idle';
  renderHandoffSheet();
  const el = $('#handoff');
  hideToast();
  el.setAttribute('aria-hidden', 'false');
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => {
    el.classList.add('open');
    const btn = el.querySelector('[data-handoff-open]');
    if (btn) btn.focus();
  });
}

function closeHandoffSheet() {
  const el = $('#handoff');
  if (!el || !el.classList.contains('open')) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('sheet-open');
  const panel = el.querySelector('.sheet-panel');
  if (panel) panel.style.transform = '';
  const bd = el.querySelector('.sheet-backdrop');
  if (bd) bd.style.opacity = '';
  handoffProvider = null;
}

function confirmHandoff() {
  const p = handoffProvider;
  if (!p) return;
  const text = (state.to && state.to.title) || (state.trip && state.trip.to && state.trip.to.title) || '';
  // Clipboard write must stay in this click tick, before any navigation (iOS).
  const ok = copyText(text);
  setCopyState(ok ? 'to' : 'fail');
  navigateToProvider(p, { delay: 0 });
}

function copyHandoffPickup() {
  const text = (state.from && state.from.title) || (state.trip && state.trip.from && state.trip.from.title) || '';
  const ok = copyText(text);
  setCopyState(ok ? 'from' : 'fail');
}

function bindSheetGestures() {
  const el = $('#handoff');
  if (!el) return;
  let drag = null;
  el.addEventListener('touchstart', (e) => {
    if (!el.classList.contains('open') || e.touches.length !== 1) return;
    if (!e.target.closest('.sheet-handle, .sheet-head')) return;
    const panel = el.querySelector('.sheet-panel');
    if (!panel) return;
    drag = { y: e.touches[0].clientY, dy: 0, panel };
    panel.style.transition = 'none';
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!drag) return;
    drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
    drag.panel.style.transform = `translateY(${drag.dy}px)`;
    const bd = el.querySelector('.sheet-backdrop');
    if (bd) bd.style.opacity = String(Math.max(0.12, 1 - drag.dy / 320));
  }, { passive: true });
  const end = () => {
    if (!drag) return;
    const { dy, panel } = drag;
    drag = null;
    panel.style.transition = '';
    const bd = el.querySelector('.sheet-backdrop');
    if (bd) bd.style.opacity = '';
    if (dy > 88) closeHandoffSheet();
    else panel.style.transform = '';
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}

// ── events ──────────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-handoff-close]')) { closeHandoffSheet(); return; }
  if (e.target.closest('[data-handoff-open]')) { confirmHandoff(); return; }
  if (e.target.closest('[data-handoff-copy-from]')) { copyHandoffPickup(); return; }
  const t = e.target.closest('button, [data-toggle]');
  if (!t) return;
  if (t.matches('.stop')) return openPicker(t.dataset.field);
  if (t.id === 'swap') {
    [state.from, state.to] = [state.to, state.from]; renderHome();
    if (state.from && state.to) startCompare();
    return;
  }
  if (t.id === 'whenBtn') { state.whenOpen = !state.whenOpen; renderHome(); return; }
  if (t.id === 'whenNow') { state.whenISO = null; state.whenOpen = false; renderHome(); return; }
  if (t.id === 'editSaved') { state.editSaved = !state.editSaved; renderHome(); return; }
  if (t.dataset.saved) { const p = state.saved[t.dataset.saved]; if (p) setPlace('to', p); return; }
  if (t.dataset.savedEdit) return openPicker('to', t.dataset.savedEdit);
  if (t.dataset.quick) {
    const q = state.market.quickPlaces.find((x) => x.id === t.dataset.quick);
    return setPlace('to', { title: q.title, sub: q.sub, lat: q.lat, lon: q.lon });
  }
  if (t.dataset.recent) return setPlace('to', state.recents[Number(t.dataset.recent)]);
  // picker
  if (t.id === 'pkBack') return closePicker();
  if (t.dataset.locate) { closePicker(); return locate(); }
  if (t.dataset.pick) {
    const [kind, i] = t.dataset.pick.split(':');
    const list = pickerLists[kind] || [];
    return choosePlace(list[Number(i)]);
  }
  // results
  if (t.id === 'rBack') { state.runId++; showView('home'); return; }
  if (t.id === 'retry') return startCompare();
  if (t.dataset.pay) {
    state.payment = t.dataset.pay; store.set('payment', state.payment);
    const seg = $('#segPay');
    seg.style.setProperty('--i', state.market.paymentMethods.findIndex((p) => p.id === state.payment));
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pay === state.payment)));
    updateResults(); return;
  }
  if (t.dataset.sort) {
    if (t.disabled) return;
    state.sort = t.dataset.sort;
    const seg = $('#segSort');
    seg.style.setProperty('--i', state.sort === 'fastest' ? 1 : 0);
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === state.sort)));
    updateResults(); return;
  }
  if (t.dataset.toggle) {
    const id = t.dataset.toggle;
    const card = t.closest('.pc');
    const open = !state.expanded.has(id);
    open ? state.expanded.add(id) : state.expanded.delete(id);
    card.querySelector('.detail').classList.toggle('open', open);
    card.querySelectorAll('[aria-expanded]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
    return;
  }
  if (t.dataset.go) return handoff(t.dataset.go);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'pkInput') onPickerInput(e.target.value);
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'whenInput') {
    const v = e.target.value;
    state.whenISO = v ? new Date(v).toISOString() : null;
    renderHome();
    if (state.from && state.to && $('#results').classList.contains('is-active')) updateResults();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('#handoff') && $('#handoff').classList.contains('open')) { closeHandoffSheet(); return; }
  if (pickerCtx) closePicker();
});

// ── boot ────────────────────────────────────────────────────────────────────
function boot() {
  $('#marketPill').textContent = state.market.name;
  bindSheetGestures();
  renderHome();
  locate({ silent: true });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
