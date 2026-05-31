# Performance baseline procedure

Repeatable procedure for capturing mobile-emulated measurements before/after
each perf-batch ships. Numbers from each run get appended to the bottom of
this file under a dated heading.

## Environment

- Chrome with chrome-devtools-mcp or DevTools.
- Mobile emulation:
  - Viewport: `390x844x3, mobile, touch`
  - CPU throttling: `4x`
  - Network: `Slow 4G`
- "Disable cache" enabled in DevTools Network tab.
- Target URL: production `https://raitsikat.rigster.cv/` (use `?perf=1` for runtime scenarios).

## Scenario 1 — Cold load LCP

1. Hard-reload `https://raitsikat.rigster.cv/`.
2. Capture a performance trace covering navigation start through first idle.
3. Record from the trace:
   - `LCP (ms)`
   - `LCP — resource load delay (ms)`
   - `Max critical chain depth`
   - `Render-blocking request count`

**Pass criterion:** LCP < 2000 ms, max critical chain ≤ 6.

## Scenario 2 — Bus idle 10 s

1. Open `https://raitsikat.rigster.cv/?perf=1`.
2. Switch to "BUSSIT". Wait 10 s.
3. From DevTools / chrome-devtools `evaluate_script`:
   ```js
   window.__perf.snapshot()
   ```
4. Record:
   - `updatesPerSec`
   - `vehicleCount`, `activeMarkerCount`
   - `medianFrameMs`, `p95FrameMs`
   - `longTaskCount`, `longTaskTotalMs`
   - `usedJsHeapMB`

**Pass criteria:**
- After Batch C: `updatesPerSec ≤ vehicleCount * 4 / 1000 * windowSec` (i.e. ≤ 4 Hz per vehicle).
- After Batch C: `activeMarkerCount < vehicleCount` (culling active).
- `medianFrameMs ≤ 16.7` on the throttled emulation.

## Scenario 3 — Bus pan + zoom

1. Continue from Scenario 2.
2. Pan the map ~half a screen north, then ~half a screen east, then double-tap to zoom in.
3. Immediately call `window.__perf.snapshot()` and record `p95FrameMs`, `maxFrameMs`, `longTaskCount`.

**Pass criterion:** `p95FrameMs ≤ 33` (i.e. ≥ 30 fps under interaction).

## Recorded runs

### 2026-05-16 baseline (production, no perf batches)

Captured from `https://raitsikat.rigster.cv/` on 2026-05-16 with the
mobile emulation profile above.

**Scenario 1 — Cold load**
- LCP: **2440 ms** (fails <2000 ms target)
- LCP load-delay: 2391 ms (98 % of LCP)
- Critical chain depth: **5** (`html → main.js → stops.js → map.js → bus/stops`)
- Render-blocking requests: **4** (style.css, leaflet.css, leaflet.js, fonts.googleapis css)
- CLS: 0.14

Scenarios 2 + 3 not capturable on production — they require the `?perf=1`
probe (Batch 0), which only exists on the local build.

### 2026-05-16 post-all-batches (localhost, Batches 0+A+B+C applied)

Captured from `http://localhost:3000/?perf=1` with the same mobile emulation
profile. All four batches applied (uncommitted on `main`).

**Scenario 1 — Cold load** (run on `http://localhost:3000/`)
- LCP: **1807 ms** (Δ **−633 ms** vs baseline; passes <2000 ms target)
- LCP load-delay: 1760 ms (97 % of LCP)
- Critical chain depth: **3** (Δ **−2** vs baseline; `html → tram/events`,
  `html → fonts.googleapis → woff2`. JS modules promoted out of the critical
  path by `modulepreload`.)
- Render-blocking requests: **3** (Δ **−1** vs baseline — leaflet.js is no
  longer render-blocking thanks to `defer`)
- CLS: 0.05 (Δ −0.09 vs baseline)

**Scenario 2 — Bus idle 10 s**
- updatesPerSec: **323** (cap is `vehicleCount × 4 = 1400/s`; well under cap → Batch C coalescing in effect)
- vehicleCount / activeMarkerCount: **350 / 71** (culling keeps ~20 % of fleet in DOM)
- medianFrameMs / p95FrameMs: **8.3 / 9.3 ms** (target ≤16.7 ms; passes by ~2×)
- longTaskCount / longTaskTotalMs: **0 / 0**
- usedJsHeapMB: **18.3**

**Scenario 3 — Bus pan + zoom**
- Before gesture: p95 9.2 ms, max 9.4 ms, longTaskCount 0
- After pan + pan + zoom-in: p95 **9.3 ms**, max **75.9 ms**, longTaskCount **1** (70 ms)
- activeMarkerCount after gesture: **20** (pan + zoom moved the map and culled further)
- Pass: p95 ≤ 33 ms target met by 3.5×; one expected reconcile spike during the zoom.

### 2026-05-31 post-Astro-bundling (localhost)

Captured from `http://localhost:3000/` after the Astro migration: the shell
is SSR'd by Astro (middleware mode) and the client is now TypeScript bundled
by Astro/Vite (no more unbundled `public/js` + hand-written modulepreload
list). Same mobile emulation profile. Compared to the 2026-05-16 localhost
post-all-batches run.

**Scenario 1 — Cold load** (DevTools performance trace, reload)
- LCP: **1423 ms** (Δ **−384 ms** vs 1807 ms; passes <2000 ms target). Breakdown:
  TTFB 2 ms, load-delay 1353 ms, load-duration 1 ms, render-delay 67 ms.
- Render-blocking requests: **2** (Δ −1) — `/style.css` and the bundled
  `_astro/vehicles.*.css` (Leaflet's CSS, now imported in `map.ts`). Chrome
  estimates 0 ms FCP/LCP savings from them.
- Critical chain (longest): `/ → _astro/<entry>.js → _astro/vehicles.*.js
  (app + Leaflet) → /bus/stops + analytics`; max critical-path latency
  **1999 ms**, depth ~4 (passes ≤6). Note: bundling reintroduced one JS hop —
  the entry loads, then discovers the shared `vehicles` chunk — because Astro
  does not auto-emit a `<link rel=modulepreload>` for a bundled `<script>`'s
  sub-chunks. The hashed chunk name rules out a hand-written preload; flattening
  it would need a Vite chunking/preload tweak. LCP is unaffected (text element,
  render-delay only 67 ms); the hop delays time-to-first-markers, not LCP.
- CLS: **0.08** (Δ +0.03 vs 0.05; still under the 0.1 good threshold).

Scenarios 2 + 3 (runtime frame timings via `?perf=1`) unchanged by this work —
the hot-path code is the same, only its packaging changed — so not re-run here.
