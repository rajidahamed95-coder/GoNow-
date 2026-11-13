// ─────────────────────────────────────────────────────────────────────────────
// Market config: SINGAPORE (first market)
//
// Everything market-specific lives in this file: currency, geocoder/router
// choices, time bands, taxi tariff, providers, fees and hand-off links.
// The UI (js/app.js) and the fare engine (js/engine.js) contain NO Singapore
// constants. To add a country, copy js/markets/_template.js (see
// docs/ADDING_A_MARKET.md) and register it in js/markets/index.js.
//
// Sources for every number are noted inline. "secondary" = only found on a
// secondary source (MissLobang, 3 Nov 2026) and must be re-verified against the
// provider's own page before launch. "placeholder" = invented starting values
// that MUST be calibrated; they are clearly labelled in the UI.
// ─────────────────────────────────────────────────────────────────────────────

const enc = encodeURIComponent;

const sg = {
  id: 'sg',
  enabled: true,
  name: 'Singapore',
  flag: 'SG',
  locale: 'en-SG',
  timezone: 'Asia/Singapore',
  currency: { code: 'SGD', symbol: 'S$', decimals: 2 },
  center: { lat: 1.3521, lon: 103.8198 },
  // [south, west, north, east]
  bbox: [1.15, 103.55, 1.50, 104.10],

  // Order = priority. Each entry is an adapter id from js/geo.js.
  geocoders: ['onemap', 'nominatim'],
  routers: ['osrm'],
  nominatim: { countrycodes: 'sg' },

  // Public holidays (affect taxi peak rules). Verify yearly against MOM.
  publicHolidays: [
    '2026-01-01', '2026-02-17', '2026-02-18', '2026-03-21', '2026-04-03',
    '2026-05-01', '2026-05-27', '2026-06-01', '2026-08-10', '2026-11-09',
    '2026-12-25',
  ],

  paymentMethods: [
    { id: 'cash', label: 'Cash' },
    { id: 'card', label: 'Card' },
    { id: 'wallet', label: 'PayLah · NETS' },
  ],
  defaultPayment: 'cash',

  // Places offered as one-tap chips (coords are public venue locations).
  quickPlaces: [
    { id: 'changi-t3', title: 'Changi Airport T3', sub: 'Terminal 3 · Airport Blvd', lat: 1.3554, lon: 103.9860 },
    { id: 'mbs', title: 'Marina Bay Sands', sub: '10 Bayfront Ave', lat: 1.2834, lon: 103.8607 },
    { id: 'orchard', title: 'Orchard Road', sub: 'ION Orchard · 2 Orchard Turn', lat: 1.3040, lon: 103.8318 },
    { id: 'sentosa', title: 'Sentosa', sub: 'Resorts World Sentosa', lat: 1.2560, lon: 103.8210 },
    { id: 'jewel', title: 'Jewel Changi', sub: '78 Airport Blvd', lat: 1.3602, lon: 103.9894 },
    { id: 'gbtb', title: 'Gardens by the Bay', sub: '18 Marina Gardens Dr', lat: 1.2816, lon: 103.8636 },
  ],

  // OSRM gives free-flow time. Multiply by a traffic factor per band.
  // PLACEHOLDER values — calibrate against real trips.
  trafficFactor: { peak: 1.5, offpeak: 1.2, late: 1.0 },
  // Fallback when no router is reachable (straight line → road distance/time).
  fallbackRouting: { circuity: 1.35, avgKmh: 28 },

  // Time bands, used by taxi surcharges and the private-hire model.
  // days: 'weekday' (Mon–Fri, not a public holiday) | 'weekendPh' | 'all'
  timeBands: {
    peak: [
      { days: 'weekday',   from: '06:00', to: '09:29' },
      { days: 'all',       from: '17:00', to: '23:59' },
      { days: 'weekendPh', from: '10:00', to: '13:59' },
    ],
    late: [{ days: 'all', from: '00:00', to: '05:59' }],
  },

  // Rough ERP model. PLACEHOLDER: gantries are not looked up, this is only a
  // guess for city-centre entry, shown as its own labelled line.
  erp: {
    note: 'Rough guess for city-centre entry. Real ERP depends on the exact route and gantries.',
    zones: [
      {
        id: 'cbd', center: { lat: 1.2840, lon: 103.8515 }, radiusKm: 1.3,
        days: 'weekday',
        rates: [
          { from: '07:30', to: '09:29', amount: 3 },
          { from: '09:30', to: '17:59', amount: 2 },
          { from: '18:00', to: '19:59', amount: 2 },
        ],
        hiFactor: 1.5, loFactor: 0,
      },
    ],
  },

  // Venue / pick-up zone surcharges for TAXIS (CDG fares page, 13 Nov 2026).
  // Not every venue is modelled (Seletar, Tanah Merah, Expo, MBS Sun/PH are not).
  pickupZones: [
    { id: 'changi', label: 'Changi Airport pick-up surcharge', circles: [
        { lat: 1.3560, lon: 103.9890, r: 1.7 }, { lat: 1.3395, lon: 103.9865, r: 0.7 } ],
      rules: [{ from: '17:00', to: '23:59', amount: 8 }], default: 6 },
    { id: 'gbtb', label: 'Gardens by the Bay pick-up surcharge', circles: [{ lat: 1.2816, lon: 103.8636, r: 0.45 }],
      rules: [], default: 3 },
    { id: 'rws', label: 'Resorts World Sentosa pick-up surcharge', circles: [{ lat: 1.2560, lon: 103.8210, r: 0.6 }],
      rules: [], default: 3 },
    { id: 'mbcc', label: 'Marina Bay Cruise Centre pick-up surcharge', circles: [{ lat: 1.2640, lon: 103.8590, r: 0.4 }],
      rules: [{ from: '07:00', to: '16:59', amount: 5 }], default: 3 },
    { id: 'mandai', label: 'Mandai Wildlife pick-up surcharge', circles: [{ lat: 1.4040, lon: 103.7890, r: 0.9 }],
      rules: [{ from: '13:00', to: '23:59', amount: 5 }], default: 0 },
    { id: 'cbd-eve', label: 'City-area evening pick-up surcharge', circles: [{ lat: 1.2840, lon: 103.8515, r: 1.3 }],
      rules: [{ from: '17:00', to: '23:59', amount: 3 }], default: 0 },
  ],

  providers: [
    // ── CDG Zig metered taxi: published tariff ──────────────────────────────
    {
      id: 'zig',
      name: 'CDG Zig',
      monogram: 'Z',
      service: 'Metered taxi',
      seats: 4,
      etaSourced: false,
      pricing: {
        type: 'meteredTaxi',
        label: 'Tariff',
        // https://www.cdgtaxi.com.sg/fares_oct/  (checked 13 Nov 2026)
        flagDown: 4.60, flagDownKm: 1,
        step1: { untilKm: 10, everyKm: 0.4, fare: 0.27 },
        step2: { everyKm: 0.35, fare: 0.27 },
        waiting: { everySec: 45, fare: 0.27 },
        // Share of trip time charged as waiting/slow traffic (unknowable → range)
        waitingShare: { lo: 0, mid: 0.05, hi: 0.15 },
        distanceSpread: { lo: 0.97, mid: 1, hi: 1.06 },
        surcharges: { peakPct: 0.25, latePct: 0.5 },
        bookingFee: { peak: 3.30, offpeak: 2.30 },
        // Fixed payment charges: 10% admin charge (+GST) on card/Apple Pay/Google Pay,
        // $0.30 for PayLah/NETS, none for cash. Applied to the metered fare.
        payment: {
          card:   { pct: 0.10, gst: 0.09, label: 'Card admin charge (10% + GST)' },
          wallet: { flat: 0.30, label: 'PayLah / NETS admin charge' },
        },
        source: 'https://www.cdgtaxi.com.sg/fares_oct/',
      },
      handoff: {
        prefill: 'none',
        action: 'Open CDG Zig',
        links: () => ({
          ios: 'https://apps.apple.com/sg/app/cdg-zig-taxis-cars/id954951647',
          android: 'https://play.google.com/store/apps/details?id=com.codigo.comfort',
          web: 'https://zig.live/riders/',
        }),
      },
    },

    // ── Grab ────────────────────────────────────────────────────────────────
    {
      id: 'grab',
      name: 'Grab',
      monogram: 'G',
      service: 'Standard car',
      seats: 4,
      etaSourced: false,
      pricing: {
        type: 'modelled',
        label: 'Modelled',
        // PLACEHOLDER MODEL — not Grab's real pricing. Calibrate!
        model: { version: 'placeholder-0', base: 3.2, perKm: 0.62, perMin: 0.28, min: 8,
                 bandMult: { peak: 1.25, late: 1.15, offpeak: 1.0 }, rangePct: 0.18 },
      },
      fees: [
        { id: 'platform', label: 'Platform fee', amount: 1.20,
          source: 'https://www.businesstimes.com.sg/singapore/grab-comfortdelgro-taxi-raise-platform-fees-jan-1', confidence: 'primary' },
        { id: 'fuel', label: 'Fuel surcharge', amount: 0.90, validUntil: '2026-11-30',
          source: 'https://www.misslobang.com/article/best-ride-hailing-apps-singapore-2026', confidence: 'secondary' },
      ],
      handoff: {
        // Grab's partner docs (developer.grab.com/docs/partner-farefeed/) show this
        // deep-link format. Documented for partners; unverified for non-partners.
        prefill: 'documented',
        action: 'Open Grab',
        links: (t) => {
          const direct = 'grab://open?' + [
            `dropOffAddress=${enc(t.to.title)}`,
            `dropOffLatitude=${t.to.lat}`, `dropOffLongitude=${t.to.lon}`,
            `pickUpAddress=${enc(t.from.title)}`,
            `pickUpLatitude=${t.from.lat}`, `pickUpLongitude=${t.from.lon}`,
            'screenType=BOOKING',
          ].join('&');
          return {
            // onelink opens the app if installed, otherwise the web/app store
            universal: `https://grab.onelink.me/2695613898?af_dp=${enc(direct)}&c=&pid=`,
            direct,
            web: 'https://www.grab.com/sg/transport/',
          };
        },
      },
    },

    // ── Gojek ───────────────────────────────────────────────────────────────
    {
      id: 'gojek',
      name: 'Gojek',
      monogram: 'Go',
      service: 'GoCar',
      seats: 4,
      etaSourced: false,
      pricing: {
        type: 'modelled',
        label: 'Modelled',
        model: { version: 'placeholder-0', base: 3.0, perKm: 0.60, perMin: 0.27, min: 8,
                 bandMult: { peak: 1.25, late: 1.15, offpeak: 1.0 }, rangePct: 0.15 },
      },
      fees: [
        { id: 'platform', label: 'Platform fee', amount: { lo: 1.10, hi: 1.70 },
          source: 'https://www.gojek.com/sg/help/customer/gocar/how-much-does-a-gocar-trip-cost', confidence: 'primary' },
        { id: 'cashless', label: 'Cashless payment fee', payments: ['card', 'wallet'],
          amount: { byKm: { fromKm: 2, toKm: 20, lo: 0.10, hi: 0.60 } },
          source: 'https://www.gojek.com/sg/help/customer/gocar/how-much-does-a-gocar-trip-cost', confidence: 'primary' },
      ],
      handoff: {
        prefill: 'none',
        action: 'Open Gojek',
        // gojek:// is documented as opening the app (Midtrans docs); ride prefill unconfirmed.
        links: () => ({
          scheme: 'gojek://',
          // iOS store id from memory — UNVERIFIED, check before launch
          ios: 'https://apps.apple.com/sg/app/gojek/id944875099',
          android: 'https://play.google.com/store/apps/details?id=com.gojek.app',
          web: 'https://www.gojek.com/sg/',
        }),
      },
    },

    // ── TADA ────────────────────────────────────────────────────────────────
    {
      id: 'tada',
      name: 'TADA',
      monogram: 'T',
      service: 'AnyTADA',
      seats: 4,
      etaSourced: false,
      pricing: {
        type: 'modelled',
        label: 'Modelled',
        model: { version: 'placeholder-0', base: 2.8, perKm: 0.58, perMin: 0.26, min: 8,
                 bandMult: { peak: 1.25, late: 1.15, offpeak: 1.0 }, rangePct: 0.14 },
      },
      fees: [
        { id: 'platform', label: 'Platform fee', amount: { lo: 1.05, hi: 1.25 },
          source: 'https://www.misslobang.com/article/best-ride-hailing-apps-singapore-2026', confidence: 'secondary' },
        { id: 'fuel', label: 'Fuel support charge', validUntil: '2026-11-30',
          amount: { tiers: [{ upTo: 18, amount: 0.90 }, { amount: 1.20 }] },
          source: 'https://www.misslobang.com/article/best-ride-hailing-apps-singapore-2026', confidence: 'secondary' },
      ],
      handoff: {
        prefill: 'none',
        action: 'Open TADA',
        // Branch universal link seen on TADA's own listings: opens app or store.
        links: () => ({
          universal: 'https://tada-rider.app.link/jHERq3GUrJb',
          ios: 'https://apps.apple.com/sg/app/tada-ride-hailing/id1412329684',
          android: 'https://play.google.com/store/apps/details?id=io.mvlchain.tada',
          web: 'https://tada.global/',
        }),
      },
    },

    // ── Ryde ────────────────────────────────────────────────────────────────
    {
      id: 'ryde',
      name: 'Ryde',
      monogram: 'R',
      service: 'RydeX',
      seats: 4,
      etaSourced: false,
      pricing: {
        type: 'modelled',
        label: 'Modelled',
        model: { version: 'placeholder-0', base: 2.8, perKm: 0.57, perMin: 0.26, min: 8,
                 bandMult: { peak: 1.25, late: 1.15, offpeak: 1.0 }, rangePct: 0.14 },
      },
      fees: [
        { id: 'platform', label: 'Platform fee',
          amount: { tiers: [{ upTo: 18, amount: 1.25 }, { amount: 1.47 }] },
          source: 'https://www.misslobang.com/article/best-ride-hailing-apps-singapore-2026', confidence: 'secondary' },
        { id: 'cashless', label: 'Card transaction fee (1.96% + S$0.24)', payments: ['card'],
          amount: { pct: 0.0196, flat: 0.24 },
          source: 'https://www.misslobang.com/article/best-ride-hailing-apps-singapore-2026', confidence: 'secondary' },
      ],
      handoff: {
        prefill: 'none',
        action: 'Open Ryde',
        links: () => ({
          universal: 'https://ryde.app.link/QtzXDpq7y7b',
          android: 'https://play.google.com/store/apps/details?id=com.rydesharing.ryde',
          web: 'https://rydesharing.com/',
        }),
      },
    },
  ],

  disclaimer:
    'Prices are estimates, not quotes. Taxi fares follow CDG’s published tariff; private-hire fares come from a placeholder model until calibrated. Promos, tolls, tips and live surge are not included. You book and pay in the provider’s app — nothing is booked here.',
  modelNotice:
    'Private-hire fares (Grab, Gojek, TADA, Ryde) use a placeholder model with published fees. They are not provider quotes, so treat the ordering between those four as indicative only.',
};

export default sg;
