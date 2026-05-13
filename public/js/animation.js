// Smooth tween for marker positions.
//
// Each animating marker carries marker._anim = {
//   fromLat, fromLon, toLat, toLon, startTs, endTs
// } and lives in the `animating` set. A single rAF loop ticks them
// together; when a marker reaches its target, it drops out of the set
// and the loop self-stops.

import { interpolate } from "./pure.js";

const TWEEN_MS = 1000;
const animating = new Set();
let rafId = null;

export function animateTo(marker, lat, lon) {
  const now = performance.now();
  let fromLat;
  let fromLon;
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

export function stopAnimating(marker) {
  animating.delete(marker);
  marker._anim = null;
}

function tick() {
  const now = performance.now();
  for (const marker of animating) {
    const anim = marker._anim;
    if (!anim) {
      animating.delete(marker);
      continue;
    }
    const [lat, lon] = interpolate(anim, now);
    marker.setLatLng([lat, lon]);
    if (now >= anim.endTs) {
      marker._anim = null;
      animating.delete(marker);
    }
  }
  rafId = animating.size > 0 ? requestAnimationFrame(tick) : null;
}
