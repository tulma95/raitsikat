// Entry point. The submodules wire most of themselves at import time
// (map init, restoreSelection, filter listeners). This file kicks off the
// remaining startup: layout sync, stop layer, SSE.

import { sheetEl } from "./dom.js";
import { initStops } from "./stops.js";
import { connect } from "./sse.js";

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

initStops();
connect();
