// Copy to js/markets/<id>.js, fill in, and register in js/markets/index.js.
// See docs/ADDING_A_MARKET.md. Required fields are marked (required).
export default {
  id: 'xx',                       // (required) short unique id
  enabled: false,                 // set true to expose in the app
  name: 'Country / city name',    // (required)
  flag: 'XX',
  locale: 'en-XX',                // BCP-47, used for number/date formatting
  timezone: 'Region/City',        // (required) IANA tz, all time bands are evaluated in it
  currency: { code: 'XXX', symbol: '$', decimals: 2 },
  center: { lat: 0, lon: 0 },
  bbox: [0, 0, 0, 0],             // [south, west, north, east], used to detect market from GPS
  geocoders: ['nominatim'],       // adapter ids from js/geo.js (add adapters there)
  routers: ['osrm'],
  nominatim: { countrycodes: 'xx' },
  publicHolidays: [],             // 'YYYY-MM-DD'
  paymentMethods: [{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Card' }],
  defaultPayment: 'cash',
  quickPlaces: [],                // [{id,title,sub,lat,lon}]
  trafficFactor: { peak: 1.5, offpeak: 1.2, late: 1.0 },
  fallbackRouting: { circuity: 1.35, avgKmh: 28 },
  timeBands: { peak: [], late: [] },
  erp: { zones: [] },             // road-pricing zones (optional)
  pickupZones: [],                // venue surcharges (optional)
  providers: [
    // pricing.type: 'meteredTaxi' (published tariff) | 'modelled' (calibratable model)
    // fees: [{ id,label,amount,payments?,validUntil?,source,confidence }]
    // handoff: { prefill: 'documented' | 'none', action, links(trip) }
  ],
  disclaimer: 'Prices are estimates…',
  modelNotice: '',
};
