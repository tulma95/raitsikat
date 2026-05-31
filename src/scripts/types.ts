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
