// Entry point. Wires the mode switcher (link-based) and orchestrates
// teardown + reconnect when the user switches between trams and buses.

import { sheetEl, modeTabsEl } from "./dom.ts";
import { initStops, clearStops } from "./stops.ts";
import { connect } from "./sse.ts";
import type { Connection } from "./sse.ts";
import { activeMode, setActiveMode } from "./mode.ts";
import { saveAndClear, reloadForActiveMode } from "./filter.ts";
import { clearAll as clearVehicles } from "./vehicles.ts";
import { clearRoute } from "./route-overlay.ts";
import { initUserLocation } from "./location.ts";
import { reset as resetCull } from "./viewport-cull.ts";
import { currentLocale } from "./i18n.ts";
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

// (locale, mode) → URL path. The mode switcher links carry these hrefs in
// the SSR markup; this mirrors them so pushState/popstate stay in sync.
function pathFor(mode: Mode): string {
  if (currentLocale === "en") return mode === "bus" ? "/en/buses" : "/en/trams";
  return mode === "bus" ? "/bussit" : "/ratikat";
}

// URL path → mode (for popstate / direct loads). Defaults to tram.
function modeFromPath(pathname: string): Mode {
  return pathname === "/bussit" || pathname === "/en/buses" ? "bus" : "tram";
}

function syncTabUi(): void {
  for (const link of modeTabsEl.querySelectorAll<HTMLElement>("a[data-mode]")) {
    if (link.getAttribute("data-mode") === activeMode) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

let currentConn: Connection | null = null;

function startForActiveMode(): void {
  reloadForActiveMode();
  initStops();
  currentConn = connect(activeMode);
}

function switchMode(next: Mode): void {
  if (next === activeMode) return;
  if (currentConn) {
    // close() fires no events, so the old connection's toast timers would
    // never be cleared (or hidden) without an explicit dispose.
    currentConn.disposeToast();
    currentConn.es.close();
    currentConn = null;
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

// Link-based progressive enhancement: the switcher is real <a> links, so it
// works (full navigation) without JS. With JS we intercept a plain left-click
// and do an instant client-side switch + pushState. Modifier clicks
// (cmd/ctrl/shift/alt) and non-left buttons fall through to the browser so
// "open in new tab" etc. still work.
modeTabsEl.addEventListener("click", (ev) => {
  if (ev.defaultPrevented) return;
  if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) {
    return;
  }
  if (!(ev.target instanceof Element)) return;
  const link = ev.target.closest("a[data-mode]");
  if (!link || !modeTabsEl.contains(link)) return;
  const next = link.getAttribute("data-mode");
  if (next !== "tram" && next !== "bus") return;
  ev.preventDefault();
  if (next === activeMode) return;
  switchMode(next);
  history.pushState({}, "", pathFor(next));
});

// Back/forward: follow the URL's mode without a full reload.
window.addEventListener("popstate", () => {
  switchMode(modeFromPath(location.pathname));
});

syncTabUi();
startForActiveMode();
initUserLocation();
