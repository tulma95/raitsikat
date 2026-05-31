// Stop layer + on-click departures popup.
//
// /stops is fetched once at startup. Each stop becomes a small circle marker
// in `stopsPane`. The layer is attached only at zoom >= 14 so the dots don't
// clutter the city-wide view. Clicking a stop opens a popup that fetches
// /departures?id=<id> on every open. Stop interactions are independent of
// the chip filter / line-isolation state.

import L from "leaflet";
import { map, stopsLayer } from "./map.ts";
import { formatDeparture } from "./pure.ts";
import { activeMode } from "./mode.ts";
import { t } from "./i18n.ts";
import type { Mode } from "../../server/types.ts";
import type { TramStop, Departure } from "./types.ts";

// Hide departures further than this in the future. The popup's row count is
// bounded server-side (numberOfDepartures: 6 in digitransit-client.ts); the
// client only narrows by this horizon so the user sees catchable trips.
const DEPARTURE_HORIZON_MS = 15 * 60_000;

function buildStopPopupRoot(stop: TramStop): HTMLElement {
  const root = document.createElement("div");
  root.className = "tram-stop-popup";

  const name = document.createElement("div");
  name.className = "tram-stop-popup__name";
  name.textContent = stop.name || t("unknownStop");
  root.appendChild(name);

  if (stop.code) {
    const code = document.createElement("div");
    code.className = "tram-stop-popup__code";
    code.textContent = stop.code;
    root.appendChild(code);
  }

  const list = document.createElement("div");
  list.className = "tram-stop-popup__list";
  root.appendChild(list);

  return root;
}

function renderPlaceholder(list: HTMLElement, text: string): void {
  list.replaceChildren();
  const placeholder = document.createElement("div");
  placeholder.className = "tram-stop-popup__placeholder";
  placeholder.textContent = text;
  list.appendChild(placeholder);
}

function renderDepartures(list: HTMLElement, departures: Departure[]): void {
  list.replaceChildren();
  const now = Date.now();
  const visible = (departures ?? []).filter((d) => {
    const ms = Number(d.departureAt) - now;
    // Keep "now" and short-future; drop anything past 15 min and anything
    // already meaningfully in the past (defensive clock-skew window: 30s).
    return ms >= -30_000 && ms <= DEPARTURE_HORIZON_MS;
  });
  if (visible.length === 0) {
    renderPlaceholder(list, t("noDepartures"));
    return;
  }
  for (const d of visible) {
    const row = document.createElement("div");
    row.className = "tram-stop-popup__row";

    const line = document.createElement("span");
    line.className = "tram-stop-popup__line";
    line.textContent = d.line ?? "";
    row.appendChild(line);

    const time = document.createElement("span");
    time.className = "tram-stop-popup__time";
    time.textContent = formatDeparture(Number(d.departureAt), now);
    row.appendChild(time);

    list.appendChild(row);
  }
}

// circleMarker uses a fixed pixel radius, so without this the dots would
// shrink relative to the map as the user zooms in. Step up the radius (and
// the ring weight proportionally) so a stop looks like the same physical
// thing on the ground at every zoom level we show it at.
function radiusForZoom(zoom: number): number {
  return 4 + Math.max(0, zoom - 14) * 1.5;
}
function weightForZoom(zoom: number): number {
  return 1.5 + Math.max(0, zoom - 14) * 0.25;
}

function buildStopMarker(stop: TramStop, mode: Mode): L.CircleMarker {
  // Cream fill + dark ring reads as "transit stop" against both the dark
  // toned tiles and any lighter regions (parks, water labels). Small enough
  // to stay visual furniture; the ring keeps it legible at any zoom.
  const zoom = map.getZoom();
  const marker = L.circleMarker([stop.lat, stop.lon], {
    pane: "stopsPane",
    radius: radiusForZoom(zoom),
    weight: weightForZoom(zoom),
    color: "#0d0f12",
    fillColor: "#ecece6",
    fillOpacity: 1,
  });

  // Per-marker request id so a slow /departures response can't overwrite a
  // newer one (e.g. user reopens the popup quickly).
  let requestId = 0;

  marker.bindPopup(
    () => buildStopPopupRoot(stop),
    {
      className: "tram-stop-popup-wrap",
      autoPan: true,
      closeButton: true,
      maxWidth: 240,
      minWidth: 0,
      // Tip anchors to the marker. Leaflet's default [0, 7] leaves a visible
      // gap between the arrow and the small circleMarker; zero it out.
      offset: [0, 0],
    },
  );

  marker.on("popupopen", (ev) => {
    const popupEl = (ev as L.PopupEvent).popup.getElement();
    if (!popupEl) return;
    const list = popupEl.querySelector<HTMLElement>(".tram-stop-popup__list");
    if (!list) return;

    renderPlaceholder(list, t("loading"));
    const myId = ++requestId;

    fetch(`/${mode}/departures?id=${encodeURIComponent(stop.id)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((departures) => {
        if (myId !== requestId) return; // a newer open superseded us
        renderDepartures(list, Array.isArray(departures) ? departures : []);
      })
      .catch(() => {
        if (myId !== requestId) return;
        renderPlaceholder(list, t("noDepartures"));
      });
  });

  return marker;
}

function syncStopLayer(): void {
  const zoom = map.getZoom();
  const shouldShow = zoom >= 14;
  if (shouldShow && !map.hasLayer(stopsLayer)) stopsLayer.addTo(map);
  if (!shouldShow && map.hasLayer(stopsLayer)) map.removeLayer(stopsLayer);
  if (!shouldShow) return;
  const radius = radiusForZoom(zoom);
  const weight = weightForZoom(zoom);
  stopsLayer.eachLayer((m) => {
    const cm = m as L.CircleMarker;
    cm.setRadius(radius);
    cm.setStyle({ weight });
  });
}

// If /stops responds before the server-side warmup has populated the cache,
// the response is an empty array. Retry once after a short delay so a user
// who lands during the cold-boot window doesn't have to refresh.
const STOPS_RETRY_DELAY_MS = 30_000;

function loadStops(mode: Mode, retried: boolean): void {
  fetch(`/${mode}/stops`)
    .then((res) => (res.ok ? res.json() : []))
    .then((stops) => {
      // If the user already flipped modes during the in-flight fetch, drop
      // these stops — they belong to a stale mode.
      if (mode !== activeMode) return;
      if (!Array.isArray(stops) || stops.length === 0) {
        if (!retried) setTimeout(() => loadStops(mode, true), STOPS_RETRY_DELAY_MS);
        return;
      }
      for (const stop of stops) {
        if (
          !stop ||
          typeof stop.id !== "string" ||
          typeof stop.lat !== "number" ||
          typeof stop.lon !== "number"
        ) continue;
        buildStopMarker(stop, mode).addTo(stopsLayer);
      }
      syncStopLayer();
    })
    .catch(() => {
      // /stops is best-effort — silently absent on failure.
    });
}

// Drop every stop marker. Used on mode switch — the next initStops() pulls
// the new mode's stop set.
export function clearStops(): void {
  stopsLayer.clearLayers();
}

let zoomHandlerInstalled = false;

export function initStops(): void {
  if (!zoomHandlerInstalled) {
    map.on("zoomend", syncStopLayer);
    zoomHandlerInstalled = true;
  }
  loadStops(activeMode, false);
}
