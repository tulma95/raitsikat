// Active mode (tram | bus). Live-binding export — other modules read
// `activeMode` to build URLs and storage keys, and call `setActiveMode`
// (typically from the tab control) to switch.
//
// On switch we don't re-emit any state ourselves; main.js orchestrates the
// teardown + reconnect because the steps need a strict order (save selection,
// flip mode, clear DOM, reload selection, reconnect SSE).

import type { Mode } from "../../server/types.ts";

const MODE_STORAGE_KEY = "raitsikat.activeMode";

function readStored(): Mode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    if (v === "tram" || v === "bus") return v;
  } catch {}
  return "tram";
}

export let activeMode: Mode = readStored();

export function setActiveMode(mode: Mode): void {
  if (mode !== "tram" && mode !== "bus") return;
  activeMode = mode;
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {}
}
