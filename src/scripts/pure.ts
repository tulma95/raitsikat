// Pure functions — no DOM, no I/O, no module state.

export interface Anim {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  startTs: number;
  endTs: number;
}

export function escapeAttr(v: unknown): string {
  const map: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  };
  return String(v).replace(/[&<>"']/g, (c) => map[c]!);
}

// Decodes Google's encoded polyline format into [lat, lon] pairs.
// Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
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

// Linear interpolation of an animation between two lat/lon pairs.
export function interpolate(anim: Anim, now: number): [number, number] {
  if (now >= anim.endTs) return [anim.toLat, anim.toLon];
  const t = (now - anim.startTs) / (anim.endTs - anim.startTs);
  return [
    anim.fromLat + (anim.toLat - anim.fromLat) * t,
    anim.fromLon + (anim.toLon - anim.fromLon) * t,
  ];
}

// Locale strings are passed in so this stays pure (no i18n import). `inMin`
// is a template with a `{n}` placeholder, e.g. "in {n} min" / "{n} min". The
// past em-dash is locale-neutral, so it's not parameterized.
export interface DepartureLabels {
  now: string;
  inMin: string;
}

export function formatDeparture(
  departureAt: number,
  now: number,
  labels: DepartureLabels,
): string {
  const ms = departureAt - now;
  if (ms < -30_000) return "—";
  if (ms < 30_000) return labels.now;
  return labels.inMin.replace("{n}", String(Math.round(ms / 60_000)));
}
