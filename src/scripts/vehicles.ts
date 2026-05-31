// Tram markers — creation, position updates, removal, snapshot sync.
//
// `vehiclesById` is the canonical model of "what trams exist right now";
// `markers` is the Leaflet-side view layer. They share keys (vehicle.id).

import L from "leaflet";
import { map } from "./map.ts";
import { animateTo, stopAnimating } from "./animation.ts";
import type { VehicleMarker } from "./animation.ts";
import { escapeAttr } from "./pure.ts";
import { ensureLineChip, isolateLine, isVisible, updateCount, noteUpsert, noteRemove } from "./filter.ts";
import { isInView, install as installCull } from "./viewport-cull.ts";
import type { Vehicle } from "./types.ts";

export const vehiclesById = new Map<string, Vehicle>();
const markers = new Map<string, VehicleMarker>();

function shouldShow(vehicle: Vehicle): boolean {
  return isVisible(vehicle.line) && isInView(vehicle.lat, vehicle.lon);
}

// Reconcile a single marker's on-map state against the current filter +
// viewport.
function reconcileMarker(vehicle: Vehicle, marker: VehicleMarker): void {
  const want = shouldShow(vehicle);
  const onMap = map.hasLayer(marker);
  if (want && !onMap) marker.addTo(map);
  else if (!want && onMap) map.removeLayer(marker);
}

// Walk every known vehicle and reconcile its marker. Used both as the
// viewport-cull (moveend/zoomend) callback and by filter.ts when visibility
// flips for many lines at once.
export function refreshVisibility(): void {
  for (const [id, vehicle] of vehiclesById) {
    const marker = markers.get(id);
    if (marker) reconcileMarker(vehicle, marker);
  }
}

// Install the moveend/zoomend listener once.
installCull(refreshVisibility);

function makeIcon(vehicle: Vehicle): L.DivIcon {
  const heading = Number(vehicle.heading) || 0;
  const line = escapeAttr(vehicle.line);
  return L.divIcon({
    className: "",
    html:
      `<div class="tram-marker tram-marker--enter" data-line="${line}">` +
        `<div class="tram-marker__arrow" style="transform: translate(-50%, 0) rotate(${heading}deg);"></div>` +
        `<span>${line}</span>` +
      `</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

// Update an existing marker's DOM in place — no icon rebuild, no animation replay.
function updateMarkerInPlace(marker: VehicleMarker, vehicle: Vehicle): boolean {
  const root = marker._icon && marker._icon.firstElementChild;
  if (!root) return false; // not yet attached; caller will create fresh
  const arrow = root.firstElementChild;
  const label = root.lastElementChild;
  const heading = Number(vehicle.heading) || 0;
  if (arrow instanceof HTMLElement && marker._lastHeading !== heading) {
    arrow.style.transform = `translate(-50%, 0) rotate(${heading}deg)`;
    marker._lastHeading = heading;
  }
  if (label && marker._lastLine !== vehicle.line) {
    label.textContent = vehicle.line;
    root.setAttribute("data-line", vehicle.line);
    marker._lastLine = vehicle.line;
  }
  return true;
}

export function upsertVehicle(vehicle: Vehicle): void {
  const prev = vehiclesById.get(vehicle.id);
  const prevLine = prev ? prev.line : null;
  vehiclesById.set(vehicle.id, vehicle);
  noteUpsert(prevLine, vehicle.line);
  ensureLineChip(vehicle.line);

  let marker = markers.get(vehicle.id);
  if (!marker) {
    marker = L.marker([vehicle.lat, vehicle.lon], { icon: makeIcon(vehicle) });
    marker.on("click", () => isolateLine(vehiclesById.get(vehicle.id) ?? vehicle));
    markers.set(vehicle.id, marker);
    // Attach BEFORE addTo: Leaflet fires `add` synchronously inside addTo,
    // so a listener attached after would miss the event and never strip the
    // one-shot enter class.
    const m = marker;
    m.once("add", () => {
      const root = m._icon && m._icon.firstElementChild;
      if (!root) return;
      root.addEventListener(
        "animationend",
        () => root.classList.remove("tram-marker--enter"),
        { once: true },
      );
    });
    if (shouldShow(vehicle)) marker.addTo(map);
  } else {
    animateTo(marker, vehicle.lat, vehicle.lon);
    // Mutate the existing DOM instead of replacing the icon — this avoids
    // replaying the entry animation and the perceived "blink" on every tick.
    if (!updateMarkerInPlace(marker, vehicle)) {
      marker.setIcon(makeIcon(vehicle));
    }
    // The vehicle may have crossed the viewport edge or changed to a
    // filtered-out line since the last tick; the cull callback only fires on
    // map move, so reconcile here too.
    reconcileMarker(vehicle, marker);
  }
  updateCount();
}

export function removeVehicle(id: string): void {
  const v = vehiclesById.get(id);
  const marker = markers.get(id);
  if (marker) {
    stopAnimating(marker);
    map.removeLayer(marker);
    markers.delete(id);
  }
  if (v) noteRemove(v.line);
  vehiclesById.delete(id);
  updateCount();
}

export function handleSnapshot(vehicles: Vehicle[]): void {
  const incomingIds = new Set(vehicles.map((v) => v.id));
  // Snapshot the keys first — removeVehicle mutates vehiclesById.
  for (const id of [...vehiclesById.keys()]) {
    if (!incomingIds.has(id)) removeVehicle(id);
  }
  for (const v of vehicles) upsertVehicle(v);
}

// Drop every marker and clear the model. Used on mode switch — the new mode
// brings its own snapshot, and tram + bus vehicle ids can collide so we
// can't leave stale entries around.
export function clearAll(): void {
  for (const id of [...vehiclesById.keys()]) removeVehicle(id);
  installCull(refreshVisibility);
}
