import type { Mode } from "./types.ts";

const ENDPOINT = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";

const MODE_TO_GTFS: Record<Mode, "TRAM" | "BUS"> = {
  tram: "TRAM",
  bus: "BUS",
};

export interface Route {
  id: string;        // e.g. "HSL:1004"
  shortName: string; // e.g. "4", "550"
}

export interface Stop {
  id: string;   // e.g. "HSL:1234567"
  name: string;
  lat: number;
  lon: number;
  code: string; // public stop code, e.g. "0501"
}

export interface StopDeparture {
  line: string;                 // route shortName, e.g. "4"
  departureAt: number;          // absolute epoch ms
  headsign: string | null;      // kept server-side; clients ignore today
}

export interface DigitransitClient {
  listRoutes(mode: Mode): Promise<Route[]>;
  fetchPatternGeometry(routeId: string, dirId: 1 | 2): Promise<string | null>;
  listStops(mode: Mode): Promise<Stop[]>;
  fetchStopDepartures(stopId: string, mode: Mode): Promise<StopDeparture[]>;
}

// --- Runtime type guards ---------------------------------------------------
// These narrow `unknown` (parsed JSON) into the exact shapes each method reads.
// No `as`, no `<T>` casts, no `any` — narrowing is done purely via typeof /
// Array.isArray / `in` so the types reflect what was actually verified at
// runtime.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getProp(v: unknown, key: string): unknown {
  return isRecord(v) && key in v ? v[key] : undefined;
}

// listRoutes: { gtfsId: string; shortName: string } — both truthy strings.
function isRouteRow(v: unknown): v is { gtfsId: string; shortName: string } {
  if (!isRecord(v)) return false;
  const { gtfsId, shortName } = v;
  return (
    typeof gtfsId === "string" &&
    gtfsId !== "" &&
    typeof shortName === "string" &&
    shortName !== ""
  );
}

// fetchPatternGeometry: a pattern whose geometry has non-empty points.
function isPatternWithPoints(v: unknown): v is {
  directionId: number;
  patternGeometry: { points: string };
  tripsForDate: unknown;
} {
  if (!isRecord(v)) return false;
  if (typeof v.directionId !== "number") return false;
  const geom = v.patternGeometry;
  if (!isRecord(geom)) return false;
  return typeof geom.points === "string" && geom.points !== "";
}

function tripCountOf(v: unknown): number {
  const trips = getProp(v, "tripsForDate");
  return Array.isArray(trips) ? trips.length : 0;
}

// listStops: a stop row with numeric lat/lon and a truthy HSL: gtfsId/name.
function isStopRow(
  v: unknown,
  gtfsMode: string,
): v is {
  gtfsId: string;
  name: string;
  lat: number;
  lon: number;
  code: unknown;
  vehicleMode: string;
} {
  if (!isRecord(v)) return false;
  const { gtfsId, name, lat, lon, vehicleMode } = v;
  return (
    vehicleMode === gtfsMode &&
    typeof gtfsId === "string" &&
    gtfsId.startsWith("HSL:") &&
    typeof name === "string" &&
    name !== "" &&
    typeof lat === "number" &&
    typeof lon === "number"
  );
}

// fetchStopDepartures: a stoptime whose trip is on the requested mode with a
// truthy shortName.
function isDepartureRow(
  v: unknown,
  gtfsMode: string,
): v is {
  serviceDay: number;
  scheduledDeparture: number;
  realtimeDeparture: number | null;
  headsign: unknown;
  trip: { route: { mode: string; shortName: string } };
} {
  if (!isRecord(v)) return false;
  if (typeof v.serviceDay !== "number") return false;
  if (typeof v.scheduledDeparture !== "number") return false;
  const rt = v.realtimeDeparture;
  if (rt !== null && typeof rt !== "number") return false;
  const route = getProp(v.trip, "route");
  if (!isRecord(route)) return false;
  const { mode, shortName } = route;
  return (
    mode === gtfsMode && typeof shortName === "string" && shortName !== ""
  );
}

export function createDigitransitClient(apiKey: string): DigitransitClient {
  async function gql(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "digitransit-subscription-key": apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Digitransit HTTP ${res.status}: ${await res.text()}`);
    }
    const body: unknown = await res.json();
    if (!isRecord(body)) {
      throw new Error("Digitransit returned no data");
    }
    if ("errors" in body && body.errors) {
      throw new Error(`Digitransit GraphQL error: ${JSON.stringify(body.errors)}`);
    }
    if (!("data" in body) || body.data == null) {
      throw new Error("Digitransit returned no data");
    }
    return body.data;
  }

  return {
    async listRoutes(mode) {
      // GTFS modes are enum literals in the GraphQL schema; safe to inline
      // because the value comes from a fixed map.
      const gtfsMode = MODE_TO_GTFS[mode];
      const data = await gql(
        `query { routes(transportModes: [${gtfsMode}], feeds: ["HSL"]) { gtfsId shortName } }`,
        {},
      );
      const routes = getProp(data, "routes");
      if (!Array.isArray(routes)) return [];
      return routes
        .filter(isRouteRow)
        .map((r) => ({ id: r.gtfsId, shortName: r.shortName }));
    },

    async fetchPatternGeometry(routeId, dirId) {
      // Today in YYYYMMDD, anchored to Helsinki time (avoids UTC containers
      // picking yesterday's date during 22:00–24:00 UTC). Digitransit's
      // `tripsForDate` uses GTFS service dates; close enough for picking the
      // canonical pattern. "sv-SE" formats as YYYY-MM-DD which we strip to
      // YYYYMMDD.
      const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" });
      const serviceDate = fmt.format(new Date()).replaceAll("-", "");

      const data = await gql(
        `query ($routeId: String!, $serviceDate: String!) {
           route(id: $routeId) {
             patterns {
               directionId
               patternGeometry { points }
               tripsForDate(serviceDate: $serviceDate) { gtfsId }
             }
           }
         }`,
        { routeId, serviceDate },
      );
      const route = getProp(data, "route");
      if (route == null) return null;
      const patterns = getProp(route, "patterns");
      if (!Array.isArray(patterns)) return null;
      // Digitransit's directionId is 0/1 (GTFS), HFP's is 1/2.
      // Map HFP 1 -> GTFS 0, HFP 2 -> GTFS 1.
      const gtfsDir = dirId === 1 ? 0 : 1;
      const candidates = patterns
        .filter(isPatternWithPoints)
        .filter((p) => p.directionId === gtfsDir)
        .map((p) => ({
          points: p.patternGeometry.points,
          tripCount: tripCountOf(p),
        }));
      if (candidates.length === 0) return null;
      // Pick the pattern with the most trips today — that's the canonical
      // service variant. Fall back to longest geometry when no pattern has
      // any trips (e.g. service ended for the day, or weekend-only oddities).
      const maxTrips = Math.max(...candidates.map((c) => c.tripCount));
      if (maxTrips > 0) {
        candidates.sort((a, b) => b.tripCount - a.tripCount);
      } else {
        candidates.sort((a, b) => b.points.length - a.points.length);
      }
      return candidates[0].points;
    },

    async listStops(mode) {
      // The v2 `stops` query does not accept `transportModes` or `feeds` args
      // (only `ids` and `name`). We fetch the full stop list and filter
      // client-side by `vehicleMode` and `gtfsId` prefix "HSL:". Result is
      // ~360 tram stops or ~7000 bus stops out of ~8000 total — small enough
      // to keep in mem.
      const gtfsMode = MODE_TO_GTFS[mode];
      const data = await gql(
        `query { stops { gtfsId name lat lon code vehicleMode } }`,
        {},
      );
      const stops = getProp(data, "stops");
      if (!Array.isArray(stops)) return [];
      return stops
        .filter((s): s is {
          gtfsId: string;
          name: string;
          lat: number;
          lon: number;
          code: unknown;
          vehicleMode: string;
        } => isStopRow(s, gtfsMode))
        .map((s) => ({
          id: s.gtfsId,
          name: s.name,
          lat: s.lat,
          lon: s.lon,
          code: typeof s.code === "string" ? s.code : "",
        }));
    },

    async fetchStopDepartures(stopId, mode) {
      const gtfsMode = MODE_TO_GTFS[mode];
      const data = await gql(
        `query ($id: String!) {
           stop(id: $id) {
             stoptimesWithoutPatterns(numberOfDepartures: 6, omitNonPickups: true) {
               serviceDay
               scheduledDeparture
               realtimeDeparture
               headsign
               trip { route { mode shortName } }
             }
           }
         }`,
        { id: stopId },
      );
      const stop = getProp(data, "stop");
      if (stop == null) return [];
      const stoptimes = getProp(stop, "stoptimesWithoutPatterns");
      if (!Array.isArray(stoptimes)) return [];
      return stoptimes
        .filter((st): st is {
          serviceDay: number;
          scheduledDeparture: number;
          realtimeDeparture: number | null;
          headsign: unknown;
          trip: { route: { mode: string; shortName: string } };
        } => isDepartureRow(st, gtfsMode))
        .map((st) => {
          const sec = st.realtimeDeparture ?? st.scheduledDeparture;
          return {
            line: st.trip.route.shortName,
            departureAt: (st.serviceDay + sec) * 1000,
            headsign: typeof st.headsign === "string" ? st.headsign : null,
          };
        });
    },
  };
}
