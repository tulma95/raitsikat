// Active mode (tram | bus). Live-binding export — other modules read
// `activeMode` to build URLs and storage keys, and call `setActiveMode`
// (typically from the tab control) to switch.
//
// On switch we don't re-emit any state ourselves; main.js orchestrates the
// teardown + reconnect because the steps need a strict order (save selection,
// flip mode, clear DOM, reload selection, reconnect SSE).

import type { Mode } from "../../server/types.ts";

// The initial mode is authoritative from the URL: the server injects it as
// `data-mode` on <html> so deep-linking /ratikat boots tram-first and
// /bussit boots bus-first.
function readInitial(): Mode {
  const injected = document.documentElement.dataset.mode;
  if (injected === "tram" || injected === "bus") return injected;
  return "tram";
}

export let activeMode: Mode = readInitial();

export function setActiveMode(mode: Mode): void {
  if (mode !== "tram" && mode !== "bus") return;
  activeMode = mode;
}
