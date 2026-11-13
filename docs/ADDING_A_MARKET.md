# Adding a market

Everything country-specific lives in `js/markets/`. The UI (`js/app.js`), fare engine (`js/engine.js`) and
geo adapters (`js/geo.js`) contain no country constants.

1. Copy `js/markets/_template.js` to `js/markets/<id>.js` and fill it in (timezone, currency, bbox,
   holidays, payment methods, quick places, time bands, providers, disclaimer).
2. Register it in `js/markets/index.js` (import + add to the `ALL` list, set `enabled: true`).
3. Providers use one of two pricers:
   - `meteredTaxi`: a published tariff (flag-down, distance steps, waiting, surcharges). Label: **Tariff**.
   - `modelled`: base + per-km + per-minute with min fare and a range. Label: **Modelled**. Replace the
     numbers once you can calibrate against real quotes.
4. Fees use the fee DSL (flat, `{lo,hi}`, tiers by fare, by-km, pct+flat, per-payment, `validUntil`).
5. Hand-off: each provider has `handoff.links(trip)` returning `{universal?, scheme?, ios, android, web}`.
   Set `prefill: 'documented'` only if the provider documents a prefill link you have verified.
6. Geocoders/routers are listed by id in priority order (`geocoders: ['onemap','nominatim']`). Add a new
   adapter in `js/geo.js` if a country needs a local one.
7. Run `node tests/engine.test.mjs` (copy the SG assertions for your tariff), then `python3 tests/e2e.py`.
