const HELSINKI_CENTER = [60.170, 24.940];
const ZOOM = 13;
const HELSINKI_BOUNDS = L.latLngBounds([60.10, 24.78], [60.30, 25.25]);

const map = L.map("map", {
  zoomControl: true,
  attributionControl: true,
  maxBounds: HELSINKI_BOUNDS,
  maxBoundsViscosity: 1.0,
  minZoom: 11,
}).setView(HELSINKI_CENTER, ZOOM);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  minZoom: 11,
  bounds: HELSINKI_BOUNDS,
  attribution: 'Data: <a href="https://hsl.fi/en/hsl/open-data" target="_blank" rel="noopener">HSL HFP</a> · Tiles: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
}).addTo(map);
map.zoomControl.setPosition("bottomright");

// Stops live in their own pane between tiles (200) and the route polyline
// (overlayPane, 400) so they read as map furniture, not interactive markers.
map.createPane("stopsPane");
map.getPane("stopsPane").style.zIndex = 350;
const stopsLayer = L.layerGroup();

const markers = new Map();
const vehiclesById = new Map();
const enabledLines = new Set();
let allLinesEnabledByDefault = true;

const SELECTION_STORAGE_KEY = "raitsikat.lineSelection";
(function restoreSelection() {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.allOn !== "boolean" || !Array.isArray(parsed.lines)) return;
    allLinesEnabledByDefault = parsed.allOn;
    if (!parsed.allOn) for (const l of parsed.lines) if (typeof l === "string") enabledLines.add(l);
  } catch {}
})();
function saveSelection() {
  try {
    // Intersect with the chips actually rendered so retired HSL lines don't
    // accumulate forever in localStorage. saveSelection is only called from
    // chip handlers / isolateLine, after filterEl has been resolved.
    const rendered = new Set(
      Array.from(filterEl.querySelectorAll(".chip")).map((c) =>
        c.getAttribute("data-line"),
      ),
    );
    const lines = [...enabledLines].filter((l) => rendered.has(l));
    localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({ allOn: allLinesEnabledByDefault, lines }),
    );
  } catch {}
}
// Currently-displayed route polyline. `currentPathKey` is `${routeId}/${dirId}`
// or null when nothing is shown. Tied to line-isolation state — see isolateLine().
// `routeRequestId` is bumped by every showRoute()/clearRoute() so an in-flight
// fetch from an earlier click can't draw a ghost route after the user has
// moved on (clicked another tram, hit Hide all, toggled a chip).
let currentPath = null;
let currentPathKey = null;
let routeRequestId = 0;

// --- Smooth position animation ---
//
// Each animating marker carries marker._anim = {
//   fromLat, fromLon, toLat, toLon, startTs, endTs
// } and lives in the `animating` set. A single rAF loop ticks them
// together; when a marker reaches its target, it drops out of the set
// and the loop self-stops.

const TWEEN_MS = 1000;
const animating = new Set();
let rafId = null;

function interpolate(anim, now) {
  if (now >= anim.endTs) return [anim.toLat, anim.toLon];
  const t = (now - anim.startTs) / (anim.endTs - anim.startTs);
  return [
    anim.fromLat + (anim.toLat - anim.fromLat) * t,
    anim.fromLon + (anim.toLon - anim.fromLon) * t,
  ];
}

function animateTo(marker, lat, lon) {
  const now = performance.now();
  let fromLat, fromLon;
  if (marker._anim) {
    [fromLat, fromLon] = interpolate(marker._anim, now);
  } else {
    const cur = marker.getLatLng();
    fromLat = cur.lat;
    fromLon = cur.lng;
  }
  marker._anim = {
    fromLat, fromLon,
    toLat: lat, toLon: lon,
    startTs: now,
    endTs: now + TWEEN_MS,
  };
  animating.add(marker);
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

function tick() {
  const now = performance.now();
  for (const marker of animating) {
    const anim = marker._anim;
    if (!anim) { animating.delete(marker); continue; }
    const [lat, lon] = interpolate(anim, now);
    marker.setLatLng([lat, lon]);
    if (now >= anim.endTs) {
      marker._anim = null;
      animating.delete(marker);
    }
  }
  rafId = animating.size > 0 ? requestAnimationFrame(tick) : null;
}

const filterEl = document.getElementById("line-filter");
const countEls = document.querySelectorAll("[data-tram-count]");

// Keep Leaflet's bottom controls (zoom + attribution) clear of the chip tray
// on mobile by exposing the tray's live height as a CSS custom property.
const sheetEl = document.getElementById("sheet");
const syncSheetHeight = () => {
  document.documentElement.style.setProperty(
    "--sheet-height",
    `${sheetEl.offsetHeight}px`,
  );
};
new ResizeObserver(syncSheetHeight).observe(sheetEl);
syncSheetHeight();

// Click a tram → show only that line and draw its route. Click a tram of the
// same (already isolated) line → reset to show everything and clear the route.
function isolateLine(vehicle) {
  const line = vehicle.line;
  const alreadyIsolated =
    !allLinesEnabledByDefault &&
    enabledLines.size === 1 &&
    enabledLines.has(line);

  if (alreadyIsolated) {
    allLinesEnabledByDefault = true;
    for (const chip of filterEl.querySelectorAll(".chip")) {
      const l = chip.getAttribute("data-line");
      chip.setAttribute("data-on", "true");
      chip.querySelector("input").checked = true;
      enabledLines.add(l);
    }
    clearRoute();
  } else {
    allLinesEnabledByDefault = false;
    enabledLines.clear();
    enabledLines.add(line);
    for (const chip of filterEl.querySelectorAll(".chip")) {
      const on = chip.getAttribute("data-line") === line;
      chip.setAttribute("data-on", String(on));
      chip.querySelector("input").checked = on;
    }
    showRoute(vehicle.routeId, vehicle.directionId);
  }
  refreshVisibility();
  updateCount();
  saveSelection();
}

// Decodes Google's encoded polyline format into [lat, lon] pairs.
// Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;

    points.push([lat * 1e-5, lng * 1e-5]);
  }
  return points;
}

async function showRoute(routeId, dirId) {
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

function clearRoute() {
  // Invalidate any in-flight showRoute fetch.
  routeRequestId++;
  if (currentPath) {
    map.removeLayer(currentPath);
    currentPath = null;
  }
  currentPathKey = null;
}

function escapeAttr(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;",
  }[c]));
}

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

function isVisible(line) {
  return allLinesEnabledByDefault || enabledLines.has(line);
}

function updateCount() {
  const total = vehiclesById.size;
  const shown = [...vehiclesById.values()].filter((v) => isVisible(v.line)).length;
  const text = allLinesEnabledByDefault
    ? `${total} trams`
    : `${shown} / ${total} trams`;
  for (const el of countEls) el.textContent = text;
}

function upsertVehicle(vehicle) {
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

function removeVehicle(id) {
  const marker = markers.get(id);
  if (marker) {
    animating.delete(marker);
    marker._anim = null;
    map.removeLayer(marker);
    markers.delete(id);
  }
  vehiclesById.delete(id);
  updateCount();
}

function ensureLineChip(line) {
  if (filterEl.querySelector(`.chip[data-line="${CSS.escape(line)}"]`)) return;

  const on = allLinesEnabledByDefault || enabledLines.has(line);
  const chip = document.createElement("label");
  chip.className = "chip";
  chip.setAttribute("data-line", line);
  chip.setAttribute("data-on", String(on));
  chip.innerHTML = `
    <span class="chip__swatch" aria-hidden="true"></span>
    <input type="checkbox" value="${escapeAttr(line)}" ${on ? "checked" : ""} />
    <span>${escapeAttr(line)}</span>
  `;
  const cb = chip.querySelector("input");
  cb.addEventListener("change", () => {
    const chips = filterEl.querySelectorAll(".chip");
    // Clicking any chip while every line is shown isolates that one line,
    // matching the tram-marker click behavior in isolateLine().
    const everyChipOn = allLinesEnabledByDefault ||
      Array.from(chips).every((c) => c.getAttribute("data-on") === "true");

    const onlyThisOn =
      !allLinesEnabledByDefault &&
      enabledLines.size === 1 &&
      enabledLines.has(line);

    // Default: any chip change clears the route. The isolation branch below
    // re-draws it so the chip path matches the tram-marker click behavior.
    clearRoute();
    if (everyChipOn) {
      allLinesEnabledByDefault = false;
      enabledLines.clear();
      enabledLines.add(line);
      for (const c of chips) {
        const on = c.getAttribute("data-line") === line;
        c.setAttribute("data-on", String(on));
        c.querySelector("input").checked = on;
      }
      // Match tram-marker click: draw the isolated line's route if we have
      // a vehicle currently on it. If not, leave the route cleared.
      const sample = [...vehiclesById.values()].find((v) => v.line === line);
      if (sample) showRoute(sample.routeId, sample.directionId);
    } else if (!cb.checked && onlyThisOn) {
      // Deselecting the only isolated line returns to "all selected".
      allLinesEnabledByDefault = true;
      for (const c of chips) {
        c.setAttribute("data-on", "true");
        c.querySelector("input").checked = true;
        enabledLines.add(c.getAttribute("data-line"));
      }
    } else {
      allLinesEnabledByDefault = false;
      if (cb.checked) enabledLines.add(line);
      else enabledLines.delete(line);
      chip.setAttribute("data-on", String(cb.checked));
    }
    refreshVisibility();
    updateCount();
    saveSelection();
  });
  filterEl.appendChild(chip);

  // numeric-aware sort so "1, 2, 10" not "1, 10, 2"
  const chips = Array.from(filterEl.querySelectorAll(".chip"));
  chips.sort((a, b) =>
    a.getAttribute("data-line").localeCompare(
      b.getAttribute("data-line"),
      undefined, { numeric: true }
    )
  );
  chips.forEach((c) => filterEl.appendChild(c));
}

function refreshVisibility() {
  for (const [id, vehicle] of vehiclesById) {
    const marker = markers.get(id);
    if (!marker) continue;
    const visible = isVisible(vehicle.line);
    const onMap = map.hasLayer(marker);
    if (visible && !onMap) marker.addTo(map);
    if (!visible && onMap) map.removeLayer(marker);
  }
}

function trackConnection(es) {
  const el = document.getElementById("conn-toast");
  const label = el.querySelector(".conn-toast__label");
  let graceTimer = null;
  let escalateTimer = null;
  // Once we've shown "offline", stay there until the next successful open —
  // otherwise repeated `error` events would bounce the toast between
  // "reconnecting" and "offline" while still disconnected.
  let escalated = false;

  const clearTimers = () => {
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    if (escalateTimer) { clearTimeout(escalateTimer); escalateTimer = null; }
  };
  const show = (state, text) => {
    el.setAttribute("data-state", state);
    label.textContent = text;
    el.hidden = false;
  };
  const hide = () => {
    el.hidden = true;
    el.removeAttribute("data-state");
  };

  es.addEventListener("open", () => {
    escalated = false;
    clearTimers();
    hide();
  });
  es.addEventListener("error", () => {
    // EventSource will reconnect automatically. Show UI only after 2s.
    if (escalated || graceTimer || escalateTimer) return;
    graceTimer = setTimeout(() => {
      graceTimer = null;
      show("reconnecting", "Reconnecting to tram feed…");
      escalateTimer = setTimeout(() => {
        escalateTimer = null;
        escalated = true;
        show("offline", "Offline — waiting for connection");
      }, 30_000);
    }, 2_000);
  });
}

function handleSnapshot(vehicles) {
  const incomingIds = new Set(vehicles.map((v) => v.id));
  // Snapshot the keys first — removeVehicle mutates vehiclesById.
  for (const id of [...vehiclesById.keys()]) {
    if (!incomingIds.has(id)) removeVehicle(id);
  }
  for (const v of vehicles) upsertVehicle(v);
}

function connect() {
  const es = new EventSource("/events");
  trackConnection(es);
  es.addEventListener("snapshot", (ev) => {
    const { vehicles } = JSON.parse(ev.data);
    handleSnapshot(vehicles);
  });
  es.addEventListener("update", (ev) => {
    const { vehicle } = JSON.parse(ev.data);
    upsertVehicle(vehicle);
  });
  es.addEventListener("remove", (ev) => {
    const { id } = JSON.parse(ev.data);
    removeVehicle(id);
  });
  return es;
}

// --- Stop layer + on-click departures ---------------------------
//
// /stops is fetched once at startup. Each stop becomes a small circle marker
// in `stopsPane`. The layer is attached only at zoom >= 14 so the dots don't
// clutter the city-wide view. Clicking a stop opens a popup that fetches
// /departures?id=<id> on every open. Stop interactions are independent of
// the chip filter / line-isolation state.

function formatDeparture(departureAt) {
  const ms = departureAt - Date.now();
  if (ms < -30_000) return "—";
  if (ms < 30_000) return "now";
  return `in ${Math.round(ms / 60_000)} min`;
}

function syncStopLayer() {
  const shouldShow = map.getZoom() >= 14;
  if (shouldShow && !map.hasLayer(stopsLayer)) stopsLayer.addTo(map);
  if (!shouldShow && map.hasLayer(stopsLayer)) map.removeLayer(stopsLayer);
}
map.on("zoomend", syncStopLayer);

function buildStopPopupRoot(stop) {
  const root = document.createElement("div");
  root.className = "tram-stop-popup";

  const name = document.createElement("div");
  name.className = "tram-stop-popup__name";
  name.textContent = stop.name || "Unknown stop";
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

  return { root, list };
}

function renderPlaceholder(list, text) {
  list.replaceChildren();
  const placeholder = document.createElement("div");
  placeholder.className = "tram-stop-popup__placeholder";
  placeholder.textContent = text;
  list.appendChild(placeholder);
}

// Hide departures further than this in the future. The /departures endpoint
// returns up to 6 raw departures; we filter client-side so the user sees only
// what's actually catchable in the next quarter-hour.
const DEPARTURE_HORIZON_MS = 15 * 60_000;

function renderDepartures(list, departures) {
  list.replaceChildren();
  const now = Date.now();
  const visible = (departures ?? []).filter((d) => {
    const ms = Number(d.departureAt) - now;
    // Keep "now" and short-future; drop anything past 15 min and anything
    // already meaningfully in the past (defensive clock-skew window: 30s).
    return ms >= -30_000 && ms <= DEPARTURE_HORIZON_MS;
  });
  if (visible.length === 0) {
    renderPlaceholder(list, "No departures");
    return;
  }
  for (const d of visible.slice(0, 6)) {
    const row = document.createElement("div");
    row.className = "tram-stop-popup__row";

    const line = document.createElement("span");
    line.className = "tram-stop-popup__line";
    line.textContent = d.line ?? "";
    row.appendChild(line);

    const time = document.createElement("span");
    time.className = "tram-stop-popup__time";
    time.textContent = formatDeparture(Number(d.departureAt));
    row.appendChild(time);

    list.appendChild(row);
  }
}

function buildStopMarker(stop) {
  // Cream fill + dark ring reads as "transit stop" against both the dark
  // toned tiles and any lighter regions (parks, water labels). Small enough
  // to stay visual furniture; the ring keeps it legible at any zoom.
  const marker = L.circleMarker([stop.lat, stop.lon], {
    pane: "stopsPane",
    radius: 4,
    weight: 1.5,
    color: "#0d0f12",
    fillColor: "#ecece6",
    fillOpacity: 1,
  });

  // Per-marker request id so a slow /departures response can't overwrite a
  // newer one (e.g. user reopens the popup quickly).
  let requestId = 0;

  marker.bindPopup(
    () => {
      const { root } = buildStopPopupRoot(stop);
      return root;
    },
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
    const popupEl = ev.popup.getElement();
    if (!popupEl) return;
    const list = popupEl.querySelector(".tram-stop-popup__list");
    if (!list) return;

    renderPlaceholder(list, "Loading…");
    const myId = ++requestId;

    fetch(`/departures?id=${encodeURIComponent(stop.id)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((departures) => {
        if (myId !== requestId) return; // a newer open superseded us
        renderDepartures(list, Array.isArray(departures) ? departures : []);
      })
      .catch(() => {
        if (myId !== requestId) return;
        renderPlaceholder(list, "No departures");
      });
  });

  return marker;
}

fetch("/stops")
  .then((res) => (res.ok ? res.json() : []))
  .then((stops) => {
    if (!Array.isArray(stops) || stops.length === 0) return;
    for (const stop of stops) {
      if (
        !stop ||
        typeof stop.id !== "string" ||
        typeof stop.lat !== "number" ||
        typeof stop.lon !== "number"
      ) continue;
      buildStopMarker(stop).addTo(stopsLayer);
    }
    syncStopLayer();
  })
  .catch(() => {
    // /stops is best-effort — silently absent on failure.
  });

connect();
