// Viewport culling for vehicle markers. Owns the rule "is this vehicle
// currently on screen (with margin)?" and reconciles every marker's
// addTo(map)/removeLayer state on map move/zoom.
//
// Kept in its own module to avoid deepening the existing vehicles.js ↔
// filter.js import cycle.

import { map } from "./map.ts";

// 20% margin around the visible bounds: markers don't pop at the edge during
// pan; reconciliation only fires on moveend/zoomend.
const BOUNDS_PAD = 0.2;

export function isInView(lat: number, lon: number): boolean {
  return map.getBounds().pad(BOUNDS_PAD).contains([lat, lon]);
}

let installed = false;
let onChange: (() => void) | null = null;

export function install(refreshFn: () => void): void {
  onChange = refreshFn;
  if (installed) return;
  installed = true;
  map.on("moveend", () => onChange && onChange());
  map.on("zoomend", () => onChange && onChange());
}

export function reset(): void {
  // Called from main.js::switchMode. The listener stays bound (it's mode-
  // agnostic), but we clear the callback reference so a late moveend during
  // the transition doesn't reach into the old mode's state.
  onChange = null;
}
