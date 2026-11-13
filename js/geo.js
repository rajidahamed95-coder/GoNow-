// Place search, reverse geocoding and routing with graceful fallbacks.
// Adapters are keyed by id; each market lists which ones it wants (in order).
import { haversineKm } from './engine.js';

const TIMEOUT_MS = 6500;

async function fetchJson(url, signal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// ── geocoder adapters ───────────────────────────────────────────────────────
const geocoders = {
  // Singapore Land Authority OneMap public search (works without a key).
  async onemap(market, q, signal) {
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const j = await fetchJson(url, signal);
    const seen = new Set();
    const out = [];
    for (const r of j.results || []) {
      const building = r.BUILDING && r.BUILDING !== 'NIL' ? r.BUILDING : '';
      const street = `${r.BLK_NO && r.BLK_NO !== 'NIL' ? r.BLK_NO + ' ' : ''}${r.ROAD_NAME || ''}`.trim();
      const title = titleCase(building || street || r.SEARCHVAL);
      const sub = [street && building ? titleCase(street) : '', r.POSTAL && r.POSTAL !== 'NIL' ? 'S' + r.POSTAL : ''].filter(Boolean).join(' · ');
      const key = title + '|' + r.POSTAL;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title, sub, lat: Number(r.LATITUDE), lon: Number(r.LONGITUDE) });
      if (out.length >= 8) break;
    }
    return out;
  },
  // OpenStreetMap Nominatim (keyless, low-volume use).
  async nominatim(market, q, signal) {
    const [s, w, n, e] = market.bbox;
    const cc = market.nominatim && market.nominatim.countrycodes ? `&countrycodes=${market.nominatim.countrycodes}` : '';
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&q=${encodeURIComponent(q)}${cc}&viewbox=${w},${n},${e},${s}`;
    const j = await fetchJson(url, signal);
    return j.map((r) => ({
      title: r.name || (r.display_name || '').split(',')[0],
      sub: (r.display_name || '').split(',').slice(1, 3).join(',').trim(),
      lat: Number(r.lat), lon: Number(r.lon),
    }));
  },
};

function titleCase(s) {
  if (!s) return s;
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s(\-/])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Mrt|Lrt|Ion|Mbs|Nus|Ntu|Hdb|Cbd|Bto)\b/g, (x) => x.toUpperCase());
}

export async function searchPlaces(market, q, signal) {
  let lastErr;
  for (const id of market.geocoders) {
    try {
      const res = await geocoders[id](market, q, signal);
      if (res.length) return { results: res, source: id };
      lastErr = null;
    } catch (e) {
      if (e.name === 'AbortError' && signal && signal.aborted) throw e;
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return { results: [], source: null };
}

function hav(a, b, c, d) {
  const R = 6371, r = Math.PI / 180, dLat = (c - a) * r, dLon = (d - b) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function reverseGeocode(market, lat, lon) {
  // Snap to a known place first (instant, offline): airports and big venues beat shop names.
  const near = (market.quickPlaces || []).find((q) => hav(lat, lon, q.lat, q.lon) < 0.4);
  if (near) return { title: near.title, sub: near.sub };
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lon}`;
    const j = await fetchJson(url);
    const a = j.address || {};
    const title = [a.house_number, a.road].filter(Boolean).join(' ') || a.suburb || j.name || (j.display_name || '').split(',')[0];
    const sub = [a.suburb, a.postcode].filter(Boolean).join(' · ');
    if (title) return { title, sub };
  } catch (_) { /* fall through */ }
  return { title: 'Current location', sub: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
}

// ── routers ─────────────────────────────────────────────────────────────────
const routers = {
  // Public OSRM demo (keyless). Fine for a prototype, not for production.
  async osrm(market, a, b, signal) {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=simplified&geometries=geojson`;
    const j = await fetchJson(url, signal);
    if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error('No route');
    const r = j.routes[0];
    return {
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      geometry: (r.geometry && r.geometry.coordinates || []).map(([lon, lat]) => ({ lat, lon })),
      source: 'osrm',
    };
  },
};

export async function route(market, a, b, signal) {
  for (const id of market.routers) {
    try { return await routers[id](market, a, b, signal); }
    catch (e) { if (e.name === 'AbortError' && signal && signal.aborted) throw e; }
  }
  // Graceful fallback: straight line scaled to a road estimate.
  const fb = market.fallbackRouting;
  const dist = haversineKm(a, b) * fb.circuity;
  return { distanceKm: dist, durationMin: (dist / fb.avgKmh) * 60, geometry: [], source: 'estimate' };
}
