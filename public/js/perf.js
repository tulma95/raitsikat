// Opt-in performance probe. Loaded only when ?perf=1 is in the URL. Reads
// from sse.js counters, vehicles model, and Leaflet marker pane to print a
// 5s rolling summary on the console. No UI; no cost when disabled.
//
// Exposes window.__perf.snapshot() so chrome-devtools evaluate_script can
// fetch the same numbers programmatically.

import { vehiclesById } from "./vehicles.js";
import { map } from "./map.js";

const WINDOW_MS = 5_000;

// Event log: [{ts, kind, count, bytes}]
const events = [];
let lastSnapshotBytes = 0;
let lastSnapshotVehicles = 0;

function note(kind, bytes, count) {
  const ts = performance.now();
  events.push({ ts, kind, count, bytes });
  if (kind === "snapshot") {
    lastSnapshotBytes = bytes;
    lastSnapshotVehicles = count;
  }
  // Trim ahead of the next read.
  const cutoff = ts - WINDOW_MS;
  while (events.length > 0 && events[0].ts < cutoff) events.shift();
}

// Frame timing: keep last WINDOW_MS of frame gaps.
const frameGaps = [];
let lastFrame = null;
function tickFrame(now) {
  if (lastFrame !== null) {
    frameGaps.push({ ts: now, dt: now - lastFrame });
    const cutoff = now - WINDOW_MS;
    while (frameGaps.length > 0 && frameGaps[0].ts < cutoff) frameGaps.shift();
  }
  lastFrame = now;
  requestAnimationFrame(tickFrame);
}
requestAnimationFrame(tickFrame);

// Long tasks.
const longTasks = [];
try {
  const obs = new PerformanceObserver((list) => {
    const now = performance.now();
    for (const entry of list.getEntries()) {
      longTasks.push({ ts: now, dur: entry.duration });
    }
    const cutoff = now - WINDOW_MS;
    while (longTasks.length > 0 && longTasks[0].ts < cutoff) longTasks.shift();
  });
  obs.observe({ entryTypes: ["longtask"] });
} catch {
  // Safari doesn't support longtask; silently skip.
}

function countByKind(kind) {
  let n = 0;
  for (const e of events) if (e.kind === kind) n += e.count;
  return n;
}

function activeMarkerCount() {
  // Leaflet attaches markers under .leaflet-marker-pane. Each direct child is
  // a vehicle marker icon (route polyline lives in overlayPane, stops in
  // stopsPane, user dot in userLocationPane).
  const pane = map.getPane("markerPane");
  return pane ? pane.children.length : 0;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

export function snapshot() {
  const gaps = frameGaps.map((g) => g.dt).sort((a, b) => a - b);
  const longTotal = longTasks.reduce((s, t) => s + t.dur, 0);
  const heap =
    typeof performance.memory === "object" && performance.memory
      ? +(performance.memory.usedJSHeapSize / 1_048_576).toFixed(1)
      : null;
  return {
    windowSec: WINDOW_MS / 1000,
    updatesPerSec: +(countByKind("update") / (WINDOW_MS / 1000)).toFixed(1),
    removesPerSec: +(countByKind("remove") / (WINDOW_MS / 1000)).toFixed(1),
    snapshotBytes: lastSnapshotBytes,
    snapshotVehicles: lastSnapshotVehicles,
    vehicleCount: vehiclesById.size,
    activeMarkerCount: activeMarkerCount(),
    medianFrameMs: +quantile(gaps, 0.5).toFixed(2),
    p95FrameMs: +quantile(gaps, 0.95).toFixed(2),
    maxFrameMs: gaps.length ? +gaps[gaps.length - 1].toFixed(2) : 0,
    longTaskCount: longTasks.length,
    longTaskTotalMs: +longTotal.toFixed(1),
    usedJsHeapMB: heap,
  };
}

// Public surface for both DevTools console and chrome-devtools evaluate_script.
window.__perf = { snapshot };

// Wire the SSE hooks before sse.js connects. main.js imports perf.js
// synchronously when ?perf=1, before it imports anything else.
window.__perfHooks = { note };

// Periodic console summary.
setInterval(() => {
  // eslint-disable-next-line no-console
  console.table([{ t: new Date().toISOString().slice(11, 19), ...snapshot() }]);
}, WINDOW_MS);

// eslint-disable-next-line no-console
console.log("[perf] probe active. window.__perf.snapshot() for current values.");
