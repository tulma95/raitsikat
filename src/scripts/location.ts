// User's GPS position as a blue dot + accuracy circle.
//
// watchPosition triggers the browser's permission prompt on first init;
// denial / failure is silent (the dot never appears). The dot is not tied
// to a transit mode — it persists across tram/bus switches.

import L from "leaflet";
import { map } from "./map.ts";

let dot: L.CircleMarker | null = null;
let accuracyCircle: L.Circle | null = null;
let watchId: number | null = null;
let centered = false;
let permissionStatus: PermissionStatus | null = null;

function ensurePane(): void {
  if (map.getPane("userLocationPane")) return;
  // Above the route overlay (400) and stops pane (350), below default
  // marker pane (600) so vehicle markers still draw on top of the user.
  map.createPane("userLocationPane");
  map.getPane("userLocationPane")!.style.zIndex = "450";
}

function place(latlng: L.LatLngExpression, accuracy: number): void {
  const hasAccuracy =
    typeof accuracy === "number" && isFinite(accuracy) && accuracy > 0;

  // Add the accuracy circle before the dot so the dot draws on top within
  // the same pane (z-order within a pane follows insertion order).
  if (!accuracyCircle && hasAccuracy) {
    accuracyCircle = L.circle(latlng, {
      pane: "userLocationPane",
      radius: accuracy,
      weight: 1,
      color: "#4a90ff",
      fillColor: "#4a90ff",
      fillOpacity: 0.10,
      opacity: 0.45,
      interactive: false,
    }).addTo(map);
  }

  if (!dot) {
    dot = L.circleMarker(latlng, {
      pane: "userLocationPane",
      radius: 7,
      weight: 2,
      color: "#ffffff",
      fillColor: "#4a90ff",
      fillOpacity: 1,
    }).addTo(map);
  } else {
    dot.setLatLng(latlng);
  }

  if (accuracyCircle) {
    accuracyCircle.setLatLng(latlng);
    if (hasAccuracy) accuracyCircle.setRadius(accuracy);
  }
}

function startWatching(): void {
  if (watchId !== null) return;
  ensurePane();
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      place([latitude, longitude], accuracy);
      if (!centered) {
        centered = true;
        const position = L.latLng(latitude, longitude);
        // The initial city bounds must not clamp a permitted GPS location.
        const configuredBounds = map.options.maxBounds;
        const bounds = configuredBounds instanceof L.LatLngBounds
          ? configuredBounds : configuredBounds ? L.latLngBounds(configuredBounds) : null;
        if (bounds && !bounds.contains(position)) {
          map.setMaxBounds(bounds.extend(position).pad(0.1));
        }
        map.setView(position, Math.max(map.getZoom(), 15));
      }
    },
    () => {
      // Permission denied or position unavailable — silent.
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5_000,
    },
  );
}

export function initUserLocation(): void {
  if (!("geolocation" in navigator)) return;
  startWatching();
  // A denied watch can stop delivering callbacks. Restart it if the user
  // grants permission later in browser settings without reloading the app.
  navigator.permissions?.query({ name: "geolocation" }).then((status) => {
    permissionStatus = status;
    permissionStatus.addEventListener("change", () => {
      if (status.state !== "granted") return;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      startWatching();
    });
  }).catch(() => { /* watchPosition works without the Permissions API. */ });
}
