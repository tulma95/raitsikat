// Ambient globals the client relies on. `window.__i18n` is injected by an
// inline script in BaseLayout.astro before the bundled module runs;
// `window.__perf` / `window.__perfHooks` are wired by the opt-in perf probe.

interface I18nPayload {
  locale: string;
  strings: Record<string, string>;
}

interface PerfSnapshot {
  windowSec: number;
  updatesPerSec: number;
  removesPerSec: number;
  snapshotBytes: number;
  snapshotVehicles: number;
  vehicleCount: number;
  activeMarkerCount: number;
  medianFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  usedJsHeapMB: number | null;
}

interface Window {
  __i18n?: I18nPayload;
  __perf?: { snapshot: () => PerfSnapshot };
  __perfHooks?: { note: (kind: string, bytes: number, count: number) => void };
}

interface Performance {
  memory?: { usedJSHeapSize: number };
}
