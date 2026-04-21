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
  attribution: '© OpenStreetMap',
}).addTo(map);
map.zoomControl.setPosition("bottomright");

const markers = new Map();
const vehiclesById = new Map();
const enabledLines = new Set();
let allLinesEnabledByDefault = true;
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
const countEl = document.getElementById("tram-count");
const sheet = document.getElementById("sheet");
const sheetToggle = document.getElementById("sheet-toggle");
const toggleAllBtn = document.getElementById("toggle-all");

sheetToggle.addEventListener("click", () => {
  const open = sheet.classList.toggle("is-open");
  sheetToggle.setAttribute("aria-expanded", String(open));
});

toggleAllBtn.addEventListener("click", () => {
  const anyVisible = allLinesEnabledByDefault || enabledLines.size > 0;
  if (anyVisible) {
    // Hide all
    allLinesEnabledByDefault = false;
    enabledLines.clear();
    for (const chip of filterEl.querySelectorAll(".chip")) {
      chip.setAttribute("data-on", "false");
      chip.querySelector("input").checked = false;
    }
  } else {
    // Show all
    allLinesEnabledByDefault = true;
    for (const chip of filterEl.querySelectorAll(".chip")) {
      chip.setAttribute("data-on", "true");
      chip.querySelector("input").checked = true;
      enabledLines.add(chip.getAttribute("data-line"));
    }
  }
  clearRoute();
  refreshToggleAllLabel();
  refreshVisibility();
  updateCount();
});

function refreshToggleAllLabel() {
  const anyVisible = allLinesEnabledByDefault || enabledLines.size > 0;
  toggleAllBtn.textContent = anyVisible ? "Hide all" : "Show all";
}

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
  refreshToggleAllLabel();
  updateCount();
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

  const latlngs = decodePolyline(polyline);
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
  countEl.textContent = allLinesEnabledByDefault
    ? `${total} trams`
    : `${shown} / ${total} trams`;
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

  const chip = document.createElement("label");
  chip.className = "chip";
  chip.setAttribute("data-line", line);
  chip.setAttribute("data-on", "true");
  chip.innerHTML = `
    <span class="chip__swatch" aria-hidden="true"></span>
    <input type="checkbox" value="${escapeAttr(line)}" checked />
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

    if (everyChipOn) {
      allLinesEnabledByDefault = false;
      enabledLines.clear();
      enabledLines.add(line);
      for (const c of chips) {
        const on = c.getAttribute("data-line") === line;
        c.setAttribute("data-on", String(on));
        c.querySelector("input").checked = on;
      }
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
    clearRoute();
    refreshVisibility();
    refreshToggleAllLabel();
    updateCount();
  });
  enabledLines.add(line);
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
    clearTimers();
    hide();
  });
  es.addEventListener("error", () => {
    // EventSource will reconnect automatically. Show UI only after 2s.
    if (graceTimer || escalateTimer) return;
    graceTimer = setTimeout(() => {
      graceTimer = null;
      show("reconnecting", "Reconnecting to tram feed…");
      escalateTimer = setTimeout(() => {
        escalateTimer = null;
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

connect();
