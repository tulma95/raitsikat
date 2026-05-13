// Tram markers — creation, position updates, removal, snapshot sync.
//
// `vehiclesById` is the canonical model of "what trams exist right now";
// `markers` is the Leaflet-side view layer. They share keys (vehicle.id).

import { map } from "./map.js";
import { animateTo, stopAnimating } from "./animation.js";
import { escapeAttr } from "./pure.js";
import { ensureLineChip, isolateLine, isVisible, updateCount } from "./filter.js";

/** @type {Map<string, import("./types.js").Vehicle>} */
export const vehiclesById = new Map();
const markers = new Map();

function makeIcon(vehicle) {
  const heading = Number(vehicle.heading) || 0;
  const line = escapeAttr(vehicle.line);
  return L.divIcon({
    className: "",
    html:
      `<div class="tram-marker" data-line="${line}">` +
        `<div class="tram-marker__arrow" style="transform: translate(-50%, 0) rotate(${heading}deg);"></div>` +
        `<span>${line}</span>` +
      `</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

// Update an existing marker's DOM in place — no icon rebuild, no animation replay.
function updateMarkerInPlace(marker, vehicle) {
  const root = marker._icon && marker._icon.firstElementChild;
  if (!root) return false; // not yet attached; caller will create fresh
  const arrow = root.firstElementChild;
  const label = root.lastElementChild;
  if (arrow) {
    arrow.style.transform = `translate(-50%, 0) rotate(${Number(vehicle.heading) || 0}deg)`;
  }
  if (label && label.textContent !== vehicle.line) {
    label.textContent = vehicle.line;
    root.setAttribute("data-line", vehicle.line);
  }
  return true;
}

export function upsertVehicle(vehicle) {
  vehiclesById.set(vehicle.id, vehicle);
  ensureLineChip(vehicle.line);

  let marker = markers.get(vehicle.id);
  if (!marker) {
    marker = L.marker([vehicle.lat, vehicle.lon], { icon: makeIcon(vehicle) });
    marker.on("click", () => isolateLine(vehiclesById.get(vehicle.id) ?? vehicle));
    markers.set(vehicle.id, marker);
    if (isVisible(vehicle.line)) marker.addTo(map);
  } else {
    animateTo(marker, vehicle.lat, vehicle.lon);
    // Mutate the existing DOM instead of replacing the icon — this avoids
    // replaying the entry animation and the perceived "blink" on every tick.
    if (!updateMarkerInPlace(marker, vehicle)) {
      marker.setIcon(makeIcon(vehicle));
    }
  }
  updateCount();
}

export function removeVehicle(id) {
  const marker = markers.get(id);
  if (marker) {
    stopAnimating(marker);
    map.removeLayer(marker);
    markers.delete(id);
  }
  vehiclesById.delete(id);
  updateCount();
}

export function refreshVisibility() {
  for (const [id, vehicle] of vehiclesById) {
    const marker = markers.get(id);
    if (!marker) continue;
    const visible = isVisible(vehicle.line);
    const onMap = map.hasLayer(marker);
    if (visible && !onMap) marker.addTo(map);
    if (!visible && onMap) map.removeLayer(marker);
  }
}

export function handleSnapshot(vehicles) {
  const incomingIds = new Set(vehicles.map((v) => v.id));
  // Snapshot the keys first — removeVehicle mutates vehiclesById.
  for (const id of [...vehiclesById.keys()]) {
    if (!incomingIds.has(id)) removeVehicle(id);
  }
  for (const v of vehicles) upsertVehicle(v);
}
