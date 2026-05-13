// The teal polyline drawn when one line is isolated.
//
// `currentPathKey` is `${routeId}/${dirId}` or null when nothing is shown.
// `routeRequestId` is bumped by every showRoute()/clearRoute() so an in-flight
// fetch from an earlier click can't draw a ghost route after the user has
// moved on (clicked another tram, hit Hide all, toggled a chip).

import { map } from "./map.js";
import { decodePolyline } from "./pure.js";

let currentPath = null;
let currentPathKey = null;
let routeRequestId = 0;

export async function showRoute(routeId, dirId) {
  if (!routeId || (dirId !== 1 && dirId !== 2)) return;
  const key = `${routeId}/${dirId}`;
  if (currentPathKey === key) return; // already showing this exact route

  // Clear any prior polyline before fetching the new one. clearRoute()
  // bumps routeRequestId, so we capture our id *after* it.
  clearRoute();
  const myRequestId = ++routeRequestId;

  let polyline;
  try {
    const res = await fetch(`/route?id=${encodeURIComponent(routeId)}&dir=${dirId}`);
    if (!res.ok) return;
    const body = await res.json();
    polyline = body.polyline;
  } catch {
    return;
  }

  // If any other showRoute/clearRoute happened during the await, drop this result.
  if (myRequestId !== routeRequestId) return;
  if (!polyline) return;

  let latlngs;
  try {
    latlngs = decodePolyline(polyline);
  } catch (err) {
    // decodePolyline silently produces a garbage final coord on truncated
    // input rather than throwing — surface anything that does throw so
    // backend bugs don't quietly draw a malformed polyline.
    console.warn("decodePolyline failed", err);
    return;
  }
  if (latlngs.length === 0) return;
  currentPath = L.polyline(latlngs, {
    color: "#22d3b8",
    weight: 4,
    opacity: 0.85,
    interactive: false,
  }).addTo(map);
  currentPathKey = key;
}

export function clearRoute() {
  // Invalidate any in-flight showRoute fetch.
  routeRequestId++;
  if (currentPath) {
    map.removeLayer(currentPath);
    currentPath = null;
  }
  currentPathKey = null;
}
