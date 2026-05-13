// Entry point. Wires the mode tab control and orchestrates teardown +
// reconnect when the user switches between trams and buses.

import { sheetEl, modeTabsEl } from "./dom.js";
import { initStops, clearStops } from "./stops.js";
import { connect } from "./sse.js";
import { activeMode, setActiveMode } from "./mode.js";
import { saveAndClear, reloadForActiveMode } from "./filter.js";
import { clearAll as clearVehicles } from "./vehicles.js";
import { clearRoute } from "./route-overlay.js";

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

function syncTabUi() {
  for (const btn of modeTabsEl.querySelectorAll('[role="tab"]')) {
    const selected = btn.getAttribute("data-mode") === activeMode;
    btn.setAttribute("aria-selected", String(selected));
  }
}

let currentEs = null;

function startForActiveMode() {
  reloadForActiveMode();
  initStops();
  currentEs = connect(activeMode);
}

function switchMode(next) {
  if (next === activeMode) return;
  if (currentEs) {
    currentEs.close();
    currentEs = null;
  }
  saveAndClear();          // persist selection for the OLD mode, drop chips
  clearVehicles();
  clearRoute();
  clearStops();
  setActiveMode(next);     // flip activeMode (live-binding seen by everyone)
  syncTabUi();
  startForActiveMode();    // load selection for NEW mode, fetch its stops, open SSE
}

modeTabsEl.addEventListener("click", (ev) => {
  const btn = ev.target.closest('[role="tab"][data-mode]');
  if (!btn) return;
  const next = btn.getAttribute("data-mode");
  if (next === "tram" || next === "bus") switchMode(next);
});

syncTabUi();
startForActiveMode();
