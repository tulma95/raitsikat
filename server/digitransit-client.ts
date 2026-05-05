const ENDPOINT = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";

export interface TramRoute {
  id: string;        // e.g. "HSL:1004"
  shortName: string; // e.g. "4"
}

export interface TramStop {
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
  listTramRoutes(): Promise<TramRoute[]>;
  fetchPatternGeometry(routeId: string, dirId: 1 | 2): Promise<string | null>;
  listTramStops(): Promise<TramStop[]>;
  fetchStopDepartures(stopId: string): Promise<StopDeparture[]>;
}

export function createDigitransitClient(apiKey: string): DigitransitClient {
  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
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
    const body = (await res.json()) as { data?: T; errors?: unknown };
    if (body.errors) {
      throw new Error(`Digitransit GraphQL error: ${JSON.stringify(body.errors)}`);
    }
    if (!body.data) {
      throw new Error("Digitransit returned no data");
    }
    return body.data;
  }

  return {
    async listTramRoutes() {
      const data = await gql<{ routes: { gtfsId: string; shortName: string }[] }>(
        `query { routes(transportModes: [TRAM], feeds: ["HSL"]) { gtfsId shortName } }`,
        {},
      );
      return data.routes
        .filter((r) => r.gtfsId && r.shortName)
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

      const data = await gql<{
        route: {
          patterns: {
            directionId: number;
            patternGeometry: { points: string } | null;
            tripsForDate: { gtfsId: string }[] | null;
          }[];
        } | null;
      }>(
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
      if (!data.route) return null;
      // Digitransit's directionId is 0/1 (GTFS), HFP's is 1/2.
      // Map HFP 1 -> GTFS 0, HFP 2 -> GTFS 1.
      const gtfsDir = dirId === 1 ? 0 : 1;
      const candidates = data.route.patterns
        .filter((p) => p.directionId === gtfsDir && p.patternGeometry?.points)
        .map((p) => ({
          points: p.patternGeometry!.points,
          tripCount: p.tripsForDate?.length ?? 0,
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

    async listTramStops() {
      // The v2 `stops` query does not accept `transportModes` or `feeds` args
      // (only `ids` and `name`). We fetch the full stop list and filter
      // client-side by `vehicleMode === "TRAM"` and `gtfsId` prefix "HSL:".
      // Result is ~360 stops out of ~8000 total — small enough to keep in mem.
      const data = await gql<{
        stops: {
          gtfsId: string;
          name: string;
          lat: number | null;
          lon: number | null;
          code: string | null;
          vehicleMode: string | null;
        }[];
      }>(
        `query { stops { gtfsId name lat lon code vehicleMode } }`,
        {},
      );
      return data.stops
        .filter(
          (s) =>
            s.vehicleMode === "TRAM" &&
            typeof s.gtfsId === "string" &&
            s.gtfsId.startsWith("HSL:") &&
            s.name &&
            typeof s.lat === "number" &&
            typeof s.lon === "number",
        )
        .map((s) => ({
          id: s.gtfsId,
          name: s.name,
          lat: s.lat as number,
          lon: s.lon as number,
          code: s.code ?? "",
        }));
    },

    async fetchStopDepartures(stopId) {
      const data = await gql<{
        stop: {
          stoptimesWithoutPatterns: {
            serviceDay: number;
            scheduledDeparture: number;
            realtimeDeparture: number | null;
            headsign: string | null;
            trip: { route: { mode: string; shortName: string } } | null;
          }[] | null;
        } | null;
      }>(
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
      if (!data.stop || !data.stop.stoptimesWithoutPatterns) return [];
      return data.stop.stoptimesWithoutPatterns
        .filter((st) => st.trip?.route?.mode === "TRAM" && st.trip.route.shortName)
        .map((st) => {
          const sec = st.realtimeDeparture ?? st.scheduledDeparture;
          return {
            line: st.trip!.route.shortName,
            departureAt: (st.serviceDay + sec) * 1000,
            headsign: st.headsign ?? null,
          };
        });
    },
  };
}
