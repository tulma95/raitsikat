# raitsikat — regression checklist

Manual checks to run against the live dev server on `:3000` after non-trivial
changes. No automated tests — by design (see CLAUDE.md). Skip sections that
the change can't possibly touch; don't skip them because they're tedious.

Assumes `DIGITRANSIT_API_KEY` is set. Without it, the route/stop sections
short-circuit to `null` / `[]` and you can't verify them.

Endpoints below assume mode `tram` for brevity; repeat with `bus` where the
behavior should match.

## Boot

1. `npm run typecheck` — clean.
2. `curl -s localhost:3000/healthz | jq` within ~10s of boot:
   - `tram.mqttConnected: true` and `bus.mqttConnected: true`.
   - `vehicleCount` > 0 per mode during service hours.
   - `lastMqttMessageAt` within the last few seconds for both modes.
3. Server log shows `[mqtt:tram] subscribed`, `[mqtt:bus] subscribed`,
   `[route-cache:tram] refreshed N patterns`, `[stop-cache:bus] refreshed
   N stops`, etc. Cache lines may arrive over the first ~30s; bus route
   warmup is several hundred patterns and takes longer than tram.

## SSE stream (`/{mode}/events`)

1. `curl -N --max-time 15 localhost:3000/tram/events | head -c 4000` and
   the same for `/bus/events`:
   - First event is `event: snapshot` with a `vehicles` array.
   - Followed by `event: update` events during service hours.
   - Heartbeat comment lines (`: ping`) appear every ~15s on an idle stream.
2. Leave a browser tab open for ~2 minutes — no console errors, no SSE
   reconnect storm. Network panel shows one `/{mode}/events` connection,
   not many.

## Map (browser, `http://localhost:3000`)

1. Page loads, Leaflet tiles render, at least one tram marker appears within
   a few seconds during service hours.
2. Markers move smoothly — no perceived blink on update. (Regression
   indicator for `vehicles.js::updateMarkerInPlace`. If you see flicker on
   every HFP tick, that path was broken.)
3. Heading arrow on each marker matches travel direction.
4. Click an active tram → coloured route overlay appears within ~1s, follows
   actual track, ends near the line's known termini.
5. Click a different tram on a different line → previous overlay clears,
   new one appears. No stale overlay left behind.
6. Click the same tram again, or click empty map → overlay clears.

## Route endpoint (`/{mode}/route`)

Pick a route id you can see in the live snapshot (e.g. `HSL:1004` for tram,
`HSL:1075` for bus).

1. `curl -s 'localhost:3000/tram/route?id=HSL:1004&dir=1' | jq` → `{ polyline: "<non-empty string>" }`.
2. Same with `dir=2` → another polyline (different from `dir=1`).
3. `curl -s 'localhost:3000/tram/route?id=HSL:9999&dir=1' | jq` → `{ polyline: null }`. (Known-id gate.)
4. `curl -i 'localhost:3000/tram/route?id=HSL:1004'` → 400, `dir must be 1 or 2`.
5. `curl -i 'localhost:3000/tram/route?dir=1'` → 400, `missing id`.
6. HFP variant test — pick a variant id from the MQTT stream that isn't in
   the bare GTFS list (e.g. `HSL:1004H6`). `/tram/route?id=HSL:1004H6&dir=1`
   should resolve to a polyline (via the longest-known-prefix normalization
   in `route-cache.ts::normalizeRouteId`). Regression here = wrong/missing
   overlays for some lines.
7. Repeat 1–3 against `/bus/route` with a live bus route id from
   `/bus/events`.

## Stops + departures

1. `curl -s localhost:3000/tram/stops | jq 'length'` → ~350 tram stops.
   `curl -s localhost:3000/bus/stops | jq 'length'` → ~7000+ bus stops.
2. `curl -s localhost:3000/tram/stops | jq '.[0]'` — entry has `id` starting
   `HSL:`, plus `name`, `lat`, `lon`.
3. Click a stop dot on the map → popup opens, departures list within ~1s.
   - Lines look plausible (small integers / suffixes like `6T` for trams,
     three-digit + suffix like `560`, `94A` for buses).
   - Times rendered via `formatDeparture`: `now`, `in N min`, or `—`. No
     `NaN`, no negative minutes past ~30s late.
4. `curl -s 'localhost:3000/tram/departures?id=<real-stop-id>' | jq` → array
   of `{ line, departureAt }`. No `headsign` leak (server-only metadata).
5. `curl -s 'localhost:3000/tram/departures?id=HSL:doesnotexist' | jq` → `[]`.
   (Known-id gate, no Digitransit call.)
6. `curl -i 'localhost:3000/tram/departures'` → 400, `missing id`.

## Mode switching (browser)

1. Click `BUSES` tab → map clears tram markers, then fills with bus markers
   within ~1s. Side rail count flips to `N buses`. Chip filter rebuilds with
   bus line numbers. No console errors.
2. Click `TRAMS` → mirror of the above.
3. Isolate line 4 on trams, switch to buses, switch back to trams — line 4
   is still isolated (selection is persisted per mode under
   `raitsikat.lineSelection.tram` / `.bus`).
4. While a bus is isolated with route overlay shown, click `TRAMS` →
   polyline must disappear with the bus markers; no ghost overlay carries
   over.

## Filter

1. Toggle off one line in the filter UI → its markers disappear, others stay.
2. Toggle it back on → markers reappear at current positions (not at last
   pre-filter position).
3. Toggle "all off" then "all on" → state recovers cleanly. (Regression
   indicator for the `filter.js ↔ vehicles.js` cycle + `allLinesEnabledByDefault`.)
4. Click a tram, then quickly toggle its line off → route overlay clears
   with the tram. Toggle line back on → no ghost overlay reappears.

## Per-request invalidation (route + stops)

The async-on-click flows in `route-overlay.js` and `stops.js` carry a local
counter that drops stale results. To stress it:

1. Click tram A, immediately click tram B before A's `/route` resolves —
   final overlay must be B's, never A's. Repeat a few times.
2. Click stop X, immediately click stop Y — popup must show Y's departures,
   never X's. Even if X's `/departures` lands second.

If you ever see "wrong overlay for selected tram" or "wrong departures in
popup" intermittently, this counter pattern was broken.

## Failure modes

1. **MQTT drop.** Block egress to `mqtt.hsl.fi` (firewall rule, pull network
   cable, whatever's easiest) for ~30s.
   - `/healthz` flips to 503, `mqttConnected: false`.
   - Server log shows reconnect attempts every ~2s.
   - Restore connectivity → `/healthz` returns to 200 within a few seconds,
     no server restart needed.
2. **Digitransit slow / down.** If you can simulate (or just observe during
   a real outage):
   - `/route` and `/departures` for unknown ids still return immediately
     (gate short-circuits, no upstream call).
   - Already-cached `/route` responses still serve from cache.
   - `[route-cache] partial refresh` warning appears; next interval retries.
3. **Stale state.** Leave the server running overnight.
   - Vehicles that stopped reporting get evicted (state.evict interval, see
     `settings.evictIntervalMs`); map clears them.
   - No memory growth pattern in `ps`/`top`.

## Shared wire types

If `server/types.ts` changed:

1. `public/js/types.js` mirror updated.
2. Open the map, watch the browser console for "undefined" reads on
   `vehicle.*` — JSDoc won't catch a missed rename at runtime.

## Pure functions

If `parseMessage`, `normalizeRouteId`, `decodePolyline`, `interpolate`,
`formatDeparture`, or the HFP→GTFS direction flip in
`digitransit-client.ts::fetchPatternGeometry` changed:

These are the regressions that are hardest to spot by eye (a flipped
direction draws the wrong line; an off-by-one polyline decode draws the
right line offset by a few meters). After the change, focus the map +
route-overlay checks above on multiple lines in **both** directions, and
compare polyline shape to the live HSL Reittiopas as a reference. A bad
HFP→GTFS direction flip will show overlays that look fine for half the
trams and obviously wrong for the other half.
