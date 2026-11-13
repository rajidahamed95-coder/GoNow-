// Generic fare engine. Pure functions, no DOM, no market constants.
// Input: a market config (js/markets/*.js), a trip and a context.
// Output: one result per provider with itemised lines, a range and a label.

const SCEN = ['lo', 'mid', 'hi'];

// ── time helpers (evaluated in the market's timezone) ───────────────────────
export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  const dowMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    dow: dowMap[p.weekday],
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function dayKind(market, parts) {
  const weekend = parts.dow >= 6;
  const ph = market.publicHolidays.includes(parts.ymd);
  return weekend || ph ? 'weekendPh' : 'weekday';
}
function ruleMatches(rule, kind, minutes) {
  if (rule.days !== 'all' && rule.days !== kind) return false;
  return minutes >= toMin(rule.from) && minutes <= toMin(rule.to);
}
export function bandOf(market, date) {
  const parts = localParts(date, market.timezone);
  const kind = dayKind(market, parts);
  const hit = (rules) => rules.some((r) => ruleMatches(r, kind, parts.minutes));
  const late = hit(market.timeBands.late || []);
  const peak = hit(market.timeBands.peak || []);
  return { parts, kind, late, peak, id: late ? 'late' : peak ? 'peak' : 'offpeak' };
}

// ── geo helper ──────────────────────────────────────────────────────────────
export function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── pieces ──────────────────────────────────────────────────────────────────
function lerp(def, km, scn) {
  const t = Math.min(1, Math.max(0, (km - def.fromKm) / (def.toKm - def.fromKm)));
  const mid = def.lo + (def.hi - def.lo) * t;
  // range endpoints: ±25% around the interpolated value, clamped to the published span
  return scn === 'lo' ? Math.max(def.lo, mid * 0.75) : scn === 'hi' ? Math.min(def.hi, mid * 1.25) : mid;
}

function resolveFee(def, scn, ctx) {
  const a = def.amount;
  if (typeof a === 'number') return a;
  if (a.tiers) {
    const tier = a.tiers.find((t) => t.upTo === undefined || ctx.fare <= t.upTo);
    return tier.amount;
  }
  if (a.byKm) return lerp(a.byKm, ctx.km, scn);
  if (a.pct !== undefined) return ctx.fare * a.pct + (a.flat || 0);
  if (a.lo !== undefined) return scn === 'lo' ? a.lo : scn === 'hi' ? a.hi : (a.lo + a.hi) / 2;
  return 0;
}

function feeActive(def, paymentId, ymd) {
  if (def.payments && !def.payments.includes(paymentId)) return false;
  if (def.validFrom && ymd < def.validFrom) return false;
  if (def.validUntil && ymd > def.validUntil) return false;
  return true;
}

function erpFor(market, trip, band, scn) {
  const zones = (market.erp && market.erp.zones) || [];
  let total = 0, note = null;
  for (const z of zones) {
    if (z.days !== 'all' && z.days !== band.kind) continue;
    const pts = trip.geometry && trip.geometry.length ? trip.geometry : [trip.from, trip.to];
    const enters = pts.some((p) => haversineKm(p, z.center) <= z.radiusKm);
    if (!enters) continue;
    const rate = (z.rates || []).find((r) => band.parts.minutes >= toMin(r.from) && band.parts.minutes <= toMin(r.to));
    if (!rate) continue;
    const f = scn === 'lo' ? z.loFactor : scn === 'hi' ? z.hiFactor : 1;
    total += rate.amount * f;
    note = market.erp.note;
  }
  return { amount: total, note };
}

function pickupZoneFee(market, trip, band) {
  const out = [];
  for (const z of market.pickupZones || []) {
    if (!z.circles.some((c) => haversineKm(trip.from, c) <= c.r)) continue;
    const rule = (z.rules || []).find((r) => band.parts.minutes >= toMin(r.from) && band.parts.minutes <= toMin(r.to));
    const amount = rule ? rule.amount : z.default;
    if (amount > 0) out.push({ id: z.id, label: z.label, amount });
  }
  return out;
}

// ── providers ───────────────────────────────────────────────────────────────
function priceMeteredTaxi(market, p, trip, ctx, scn) {
  const c = p.pricing;
  const km = trip.distanceKm * c.distanceSpread[scn];
  const items = [];

  // Distance fare: exactly per CDG's published tariff.
  let meter = c.flagDown;
  if (km > c.flagDownKm) {
    const first = Math.min(km, c.step1.untilKm) - c.flagDownKm;
    meter += Math.ceil(first / c.step1.everyKm - 1e-9) * c.step1.fare;
    if (km > c.step1.untilKm) {
      meter += Math.ceil((km - c.step1.untilKm) / c.step2.everyKm - 1e-9) * c.step2.fare;
    }
  }
  items.push({ id: 'meter', label: 'Metered fare (distance)', amount: meter, kind: 'fare', note: `Flag-down S$${c.flagDown.toFixed(2)} + distance steps`, confidence: 'tariff' });

  // Waiting / slow traffic: unknowable → estimated share of trip time.
  const waitSec = trip.durationMin * 60 * c.waitingShare[scn];
  const wait = Math.ceil(waitSec / c.waiting.everySec) * c.waiting.fare;
  if (wait > 0) items.push({ id: 'wait', label: 'Waiting & traffic allowance', amount: wait, kind: 'est', note: 'Estimated — depends on traffic', confidence: 'estimate' });
  const metered = meter + wait;

  const pct = ctx.band.late ? c.surcharges.latePct : ctx.band.peak ? c.surcharges.peakPct : 0;
  let surcharge = 0;
  if (pct > 0) {
    surcharge = metered * pct;
    items.push({ id: 'timesurcharge', label: ctx.band.late ? 'Late-night surcharge (50%)' : 'Peak-period surcharge (25%)', amount: surcharge, kind: 'surcharge', confidence: 'tariff' });
  }
  const booking = ctx.band.peak ? c.bookingFee.peak : c.bookingFee.offpeak;
  items.push({ id: 'booking', label: 'Booking fee', amount: booking, kind: 'fee', note: ctx.band.peak ? 'Peak booking fee' : 'Off-peak booking fee', confidence: 'tariff' });

  for (const z of pickupZoneFee(market, trip, ctx.band)) {
    items.push({ id: z.id, label: z.label, amount: z.amount, kind: 'surcharge', confidence: 'tariff' });
  }
  const erp = erpFor(market, trip, ctx.band, scn);
  if (erp.amount > 0) items.push({ id: 'erp', label: 'ERP (rough guess)', amount: erp.amount, kind: 'est', note: erp.note, confidence: 'placeholder' });

  const pay = c.payment[ctx.payment];
  if (pay) {
    const base = metered + surcharge;
    const amount = pay.pct !== undefined ? base * pay.pct * (1 + (pay.gst || 0)) : pay.flat;
    items.push({ id: 'payment', label: pay.label, amount, kind: 'fee', confidence: 'tariff' });
  }
  return items;
}

function priceModelled(market, p, trip, ctx, scn) {
  const m = p.pricing.model;
  const raw = (m.base + m.perKm * trip.distanceKm + m.perMin * trip.durationMin) * (m.bandMult[ctx.band.id] || 1);
  const spread = m.rangePct * (trip.routeSource === 'estimate' ? 1.6 : 1);
  const factor = scn === 'lo' ? 1 - spread : scn === 'hi' ? 1 + spread : 1;
  const fare = Math.max(m.min, raw * factor);
  const items = [{ id: 'fare', label: 'Fare estimate', amount: fare, kind: 'est', note: 'Placeholder model, not a provider quote', confidence: 'placeholder' }];
  const fctx = { fare, km: trip.distanceKm };
  for (const f of p.fees || []) {
    if (!feeActive(f, ctx.payment, ctx.band.parts.ymd)) continue;
    const amount = resolveFee(f, scn, fctx);
    if (amount > 0) items.push({ id: f.id, label: f.label, amount, kind: 'fee', note: f.validUntil ? `Until ${f.validUntil}` : undefined, confidence: f.confidence, source: f.source });
  }
  const erp = erpFor(market, trip, ctx.band, scn);
  if (erp.amount > 0) items.push({ id: 'erp', label: 'ERP (rough guess)', amount: erp.amount, kind: 'est', note: erp.note, confidence: 'placeholder' });
  return items;
}

const PRICERS = { meteredTaxi: priceMeteredTaxi, modelled: priceModelled };

const sum = (items) => items.reduce((s, i) => s + i.amount, 0);

/**
 * @param market  market config
 * @param trip    { from:{lat,lon,title}, to:{...}, distanceKm, durationMin, routeSource, geometry? }
 * @param opts    { when: Date, payment: id }
 */
export function estimateAll(market, rawTrip, opts) {
  const band = bandOf(market, opts.when);
  // Router durations are free-flow; apply the market's traffic factor for the band.
  const tf = (market.trafficFactor && market.trafficFactor[band.id]) || 1;
  const trip = {
    ...rawTrip,
    durationMin: rawTrip.routeSource === 'osrm' ? rawTrip.durationMin * tf : rawTrip.durationMin,
  };
  const ctx = { band, payment: opts.payment };
  const results = market.providers.map((p) => {
    const fn = PRICERS[p.pricing.type];
    if (!fn) throw new Error(`Unknown pricing type ${p.pricing.type}`);
    const itemsBy = {};
    const totals = {};
    for (const s of SCEN) { itemsBy[s] = fn(market, p, trip, ctx, s); totals[s] = sum(itemsBy[s]); }
    const notes = [];
    const staleFees = (p.fees || []).filter((f) => f.validUntil && band.parts.ymd > f.validUntil);
    for (const f of staleFees) notes.push(`${f.label} not applied: listed only until ${f.validUntil}. Check the app.`);
    const zones = pickupZoneFee(market, trip, band);
    if (p.pricing.type === 'modelled' && zones.length) notes.push('Venue or airport pick-up fees for private hire are not included.');
    const secondary = (p.fees || []).some((f) => f.confidence === 'secondary');
    return {
      provider: p,
      label: p.pricing.label,
      items: itemsBy.mid,
      total: totals.mid,
      low: Math.min(totals.lo, totals.mid),
      high: Math.max(totals.hi, totals.mid),
      notes,
      feesNeedVerification: secondary,
    };
  });
  return { results, band, trip };
}

export function sortResults(results, mode) {
  const arr = [...results];
  if (mode === 'fastest') {
    // Only providers whose wait/ETA is actually sourced can be ranked by speed.
    const sourced = arr.filter((r) => r.provider.etaSourced);
    return sourced.length ? sourced.sort((a, b) => (a.provider.eta || 0) - (b.provider.eta || 0)) : arr.sort((a, b) => a.total - b.total);
  }
  return arr.sort((a, b) => a.total - b.total);
}

export function anyEtaSourced(market) {
  return market.providers.some((p) => p.etaSourced);
}
