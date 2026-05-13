# raitsikat — architecture

Things you can't tell from reading any single file. Module-level docstrings
and `index.ts` cover the rest.

## Data flow

```
HSL MQTT (tram|bus)  ──►  mqtt-client  ──►  state  ──►  sse-server  ──►  /{mode}/events  ──►  browser

Digitransit GraphQL  ──►  digitransit-client  ──┬──►  route-cache  ──►  /{mode}/route
                                                └──►  stop-cache   ──►  /{mode}/stops, /{mode}/departures
```

Two independent pipelines run in parallel — one per mode (`tram`, `bus`).
Each has its own MQTT subscription, `state` instance, SSE endpoint, and
caches; nothing is shared between them. The browser picks a mode and
points all of its fetches/SSE at the matching prefix.

`state.ts` is the per-mode join point. MQTT writes, SSE reads + subscribes
to its `update` / `remove` events. Nothing else touches it.

## Composition root

`server/index.ts` is the only file that knows the dependency graph. Every
other server module is a factory (`createX` / `startX`) that takes its
deps as arguments and returns a handle (typically `{ router }` or
`{ router, dispose }`). Routers are mounted in `index.ts` — no module
reaches for `app`. The factories take a `mode: "tram" | "bus"` so the
same factory is reused per mode; `startModePipeline(mode)` in `index.ts`
wires one full pipeline.

When adding a server module, follow the same shape: factory in, handle
out, wired in `index.ts`.

## Caches: warmup + lazy + gate

Both `route-cache` and `stop-cache` follow the same three-part pattern.
The shared mechanics live in `cache-helpers.ts`:

- **`startRefillScheduler`** runs a warmup on an interval. A tick returning
  `true` advances a long success gate (default 24h); `false` / throw
  doesn't, so failures self-heal on the next short interval. In-flight
  ticks are skipped.
- **`createCoalescer`** dedupes concurrent identical lazy lookups so N
  parallel cache-miss requests trigger one upstream call.
- **Known-id gate.** Both caches reject lookups for ids not seen during
  warmup. This isn't just an optimization — without it an attacker can
  spam arbitrary ids and burn Digitransit quota.

## Non-obvious data-shape gotchas

- **HFP variant ids → GTFS prefix.** HFP reports operational variants like
  `HSL:1004H6` that aren't in GTFS. `route-cache.ts::normalizeRouteId`
  maps these to the longest known prefix.
- **HFP direction 1/2 vs GTFS 0/1.** Mapping (HFP 1 → GTFS 0) lives in
  `digitransit-client.ts::fetchPatternGeometry`. Don't reinvent it.
- **Helsinki service date.** `fetchPatternGeometry` formats today in
  Europe/Helsinki, not UTC, so a container running 22–24h UTC doesn't ask
  Digitransit for yesterday's service.
- **`parseMessage` is pure.** `now` is injected by the caller — keep it
  that way when extending the parser.

## Frontend wiring

Plain ES modules under `public/js/`, loaded via `<script type="module">`.
No bundler. Leaflet is a global from `/vendor/leaflet/leaflet.js`
(self-hosted from `node_modules`).

**Cycle between `filter.js` ↔ `vehicles.js`.** Both import from each
other. This works because the imports are referenced only inside function
bodies — ES module live bindings resolve them at call time. Don't move
those references to module top level.

**Mutable shared flag.** `filter.js` exports `allLinesEnabledByDefault`
as `export let`. Other modules read the live binding; only `filter.js`
mutates it. The same pattern carries `activeMode` in `mode.js` — read
anywhere, mutated only via `setActiveMode`.

**Mode switch is orchestrated in `main.js`.** Order matters: save current
selection under the old mode, close the SSE, clear vehicles/route/stops,
flip `activeMode`, reload the new mode's selection, then reconnect. Don't
fan this out to a pub-sub pattern — the strict ordering is the point.

**Per-request invalidation.** Both `route-overlay.js` and `stops.js`
maintain a local counter that's bumped on every user action; in-flight
fetches check the counter on resolution and drop their result if a newer
action superseded them. Mirror this when adding any other async-on-click
flow.

**In-place marker DOM update.** `vehicles.js::updateMarkerInPlace`
mutates the existing icon DOM instead of rebuilding it. Rebuilding
replays the entry animation and produces a perceived blink on every HFP
update — don't switch back to `setIcon` without checking.

## Shared wire types

`server/types.ts` is the source of truth. `public/js/types.js` is a
JSDoc-only mirror (emits no runtime code). When the wire format changes,
update both.
