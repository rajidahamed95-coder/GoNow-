// Market registry. Add new markets here (one import + one array entry).
import sg from './sg.js';
// import my from './my.js';   // example: Malaysia, once its config exists

export const MARKETS = [sg /*, my */].filter((m) => m.enabled);
export const DEFAULT_MARKET = MARKETS[0];

export function getMarket(id) {
  return MARKETS.find((m) => m.id === id) || DEFAULT_MARKET;
}

/** Pick the market whose bbox contains the point, else null. */
export function marketAt(lat, lon) {
  return (
    MARKETS.find((m) => {
      const [s, w, n, e] = m.bbox;
      return lat >= s && lat <= n && lon >= w && lon <= e;
    }) || null
  );
}
