import type { Express, Request, Response } from "express";
import type { DigitransitClient, StopDeparture, TramStop } from "./digitransit-client.ts";

export interface StopCacheOptions {
  app: Express;
  digitransit: DigitransitClient | null;
  stopsPath?: string;
  departuresPath?: string;
  refreshIntervalMs?: number;
  refreshGateMs?: number;
  now?: () => number;
}

// `headsign` is server-only metadata; strip before sending so the wire payload
// matches the spec.
type DeparturePayload = Pick<StopDeparture, "line" | "departureAt">;

export function startStopCache(opts: StopCacheOptions): void {
  const stopsPath = opts.stopsPath ?? "/stops";
  const departuresPath = opts.departuresPath ?? "/departures";
  const refreshIntervalMs = opts.refreshIntervalMs ?? 5 * 60 * 1000;
  const refreshGateMs = opts.refreshGateMs ?? 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now;

  // Single source of truth — serves both the /stops list (via cached JSON) and
  // the /departures known-id gate (via .has()).
  const stopsById = new Map<string, TramStop>();
  // /stops is hit on every page load with a payload that changes at most once
  // a day. Cache the serialized body so we skip JSON.stringify per request.
  let stopsJson = "[]";
  // Coalesce concurrent identical lazy lookups for the same stop's departures.
  const inFlightLookups = new Map<string, Promise<DeparturePayload[]>>();
  let lastSuccessAt = 0;

  if (opts.digitransit) {
    const digitransit = opts.digitransit;
    let inFlight = false;
    const attemptRefill = async (): Promise<void> => {
      if (inFlight) return;
      if (now() - lastSuccessAt < refreshGateMs) return;
      inFlight = true;
      try {
        const fetched = await digitransit.listTramStops();
        stopsById.clear();
        for (const s of fetched) stopsById.set(s.id, s);
        stopsJson = JSON.stringify(fetched);
        lastSuccessAt = now();
        console.log(`[stop-cache] refreshed ${fetched.length} stops`);
      } catch (err) {
        console.error(
          `[stop-cache] stop list fetch failed (will retry in ${refreshIntervalMs / 1000}s):`,
          (err as Error).message,
        );
      } finally {
        inFlight = false;
      }
    };

    attemptRefill().catch((err) => console.error("[stop-cache] refill threw:", err));
    const ticker = setInterval(() => {
      attemptRefill().catch((err) => console.error("[stop-cache] refill threw:", err));
    }, refreshIntervalMs);
    ticker.unref();
  }

  opts.app.get(stopsPath, (_req: Request, res: Response) => {
    res.type("application/json").send(stopsJson);
  });

  opts.app.get(departuresPath, async (req: Request, res: Response) => {
    const stopId = typeof req.query.id === "string" ? req.query.id : "";
    if (!stopId) {
      res.status(400).json({ error: "missing id" });
      return;
    }

    if (!opts.digitransit) {
      res.json([]);
      return;
    }

    // Mirrors the route-cache known-id gate: only allow Digitransit calls for
    // stops we've published via warmup so an attacker can't burn quota with
    // arbitrary ids. Also covers the "stop list hasn't loaded yet" case.
    if (!stopsById.has(stopId)) {
      res.json([]);
      return;
    }

    let pending = inFlightLookups.get(stopId);
    if (!pending) {
      const digitransit = opts.digitransit;
      pending = (async () => {
        try {
          const departures = await digitransit.fetchStopDepartures(stopId);
          // strip headsign — server-only metadata, see DeparturePayload
          return departures.map((d) => ({ line: d.line, departureAt: d.departureAt }));
        } finally {
          inFlightLookups.delete(stopId);
        }
      })();
      inFlightLookups.set(stopId, pending);
    }

    try {
      const departures = await pending;
      res.json(departures);
    } catch (err) {
      console.error(`[stop-cache] departures fetch failed for ${stopId}:`, (err as Error).message);
      res.json([]);
    }
  });
}
