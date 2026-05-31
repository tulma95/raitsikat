// Entry point. Wires the mode tab control and orchestrates teardown +
// reconnect when the user switches between trams and buses.

import { sheetEl, modeTabsEl } from "./dom.ts";
import { initStops, clearStops } from "./stops.ts";
import { connect } from "./sse.ts";
import { activeMode, setActiveMode } from "./mode.ts";
import { saveAndClear, reloadForActiveMode } from "./filter.ts";
import { clearAll as clearVehicles } from "./vehicles.ts";
import { clearRoute } from "./route-overlay.ts";
import { initUserLocation } from "./location.ts";
import { reset as resetCull } from "./viewport-cull.ts";
import type { Mode } from "../../server/types.ts";

// Opt-in perf probe. Loaded before SSE connects so the snapshot is counted.
if (new URLSearchParams(location.search).has("perf")) {
  await import("./perf.ts");
}

// Keep Leaflet's bottom controls (zoom + attribution) clear of the chip tray
// on mobile by exposing the tray's live height as a CSS custom property.
const syncSheetHeight = () => {
  document.documentElement.style.setProperty(
    "--sheet-height",
    `${sheetEl.offsetHeight}px`,
  );
};
new ResizeObserver(syncSheetHeight).observe(sheetEl);
syncSheetHeight();

function syncTabUi(): void {
  for (const btn of modeTabsEl.querySelectorAll('[role="tab"]')) {
    const selected = btn.getAttribute("data-mode") === activeMode;
    btn.setAttribute("aria-selected", String(selected));
  }
}

let currentEs: EventSource | null = null;

function startForActiveMode(): void {
  reloadForActiveMode();
  initStops();
  currentEs = connect(activeMode);
}

function switchMode(next: Mode): void {
  if (next === activeMode) return;
  if (currentEs) {
    currentEs.close();
    currentEs = null;
  }
  saveAndClear();          // persist selection for the OLD mode, drop chips
  // resetCull() BEFORE clearVehicles(): clearAll() re-arms the cull callback
  // as its last step, so a reset() after it would wipe the freshly-installed
  // onChange and leave culling silently disabled for the rest of the session.
  resetCull();
  clearVehicles();
  clearRoute();
  clearStops();
  setActiveMode(next);     // flip activeMode (live-binding seen by everyone)
  syncTabUi();
  startForActiveMode();    // load selection for NEW mode, fetch its stops, open SSE
}

modeTabsEl.addEventListener("click", (ev) => {
  const btn = (ev.target as Element).closest('[role="tab"][data-mode]');
  if (!btn) return;
  const next = btn.getAttribute("data-mode");
  if (next === "tram" || next === "bus") switchMode(next);
});

syncTabUi();
startForActiveMode();
initUserLocation();
