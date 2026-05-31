// Wire-format types mirroring server/types.ts, plus client-only shapes.
// Vehicle is re-exported from the server source of truth so the two can't
// drift; the rest are client-only and live here. Update both sides together
// when the wire format changes.

import type { Vehicle } from "../../server/types.ts";

export type { Vehicle };

export interface SnapshotEvent {
  vehicles: Vehicle[];
}

export interface UpdateEvent {
  vehicle: Vehicle;
}

export interface RemoveEvent {
  id: string;
}

export interface TramStop {
  id: string;   // e.g. "HSL:1234567"
  name: string;
  lat: number;
  lon: number;
  code: string; // Public stop code, e.g. "0501".
}

export interface Departure {
  line: string;        // Route shortName, e.g. "4".
  departureAt: number; // Absolute epoch ms.
}

// Runtime guards for data crossing the wire (SSE payloads, /stops, /departures).
// The server is trusted, but parsed JSON is `unknown` — narrow it with these
// instead of asserting a type, so a malformed item is dropped, not trusted.

export function isVehicle(v: unknown): v is Vehicle {
  return (
    typeof v === "object" && v !== null &&
    "id" in v && typeof v.id === "string" &&
    "line" in v && typeof v.line === "string" &&
    "routeId" in v && typeof v.routeId === "string" &&
    "directionId" in v && (v.directionId === 1 || v.directionId === 2) &&
    "lat" in v && typeof v.lat === "number" &&
    "lon" in v && typeof v.lon === "number" &&
    "heading" in v && typeof v.heading === "number" &&
    "updatedAt" in v && typeof v.updatedAt === "number"
  );
}

export function isTramStop(v: unknown): v is TramStop {
  return (
    typeof v === "object" && v !== null &&
    "id" in v && typeof v.id === "string" &&
    "name" in v && typeof v.name === "string" &&
    "lat" in v && typeof v.lat === "number" &&
    "lon" in v && typeof v.lon === "number" &&
    "code" in v && typeof v.code === "string"
  );
}

export function isDeparture(v: unknown): v is Departure {
  return (
    typeof v === "object" && v !== null &&
    "line" in v && typeof v.line === "string" &&
    "departureAt" in v && typeof v.departureAt === "number"
  );
}
