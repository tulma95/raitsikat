import { Router, type Request, type Response } from "express";
import type { DigitransitClient, StopDeparture, TramStop } from "./digitransit-client.ts";
import { createCoalescer, startRefillScheduler } from "./cache-helpers.ts";

export interface StopCacheOptions {
  digitransit: DigitransitClient | null;
  stopsPath?: string;
  departuresPath?: string;
  refreshIntervalMs?: number;
  refreshGateMs?: number;
  now?: () => number;
}

export interface StopCacheHandle {
  router: Router;
}

// `headsign` is server-only metadata; strip before sending so the wire payload
// matches the spec.
type DeparturePayload = Pick<StopDeparture, "line" | "departureAt">;

export function startStopCache(opts: StopCacheOptions): StopCacheHandle {
  const stopsPath = opts.stopsPath ?? "/stops";
  const departuresPath = opts.departuresPath ?? "/departures";
  const refreshIntervalMs = opts.refreshIntervalMs ?? 5 * 60 * 1000;
  const refreshGateMs = opts.refreshGateMs ?? 24 * 60 * 60 * 1000;

  // Single source of truth — serves both the /stops list (via cached JSON) and
  // the /departures known-id gate (via .has()).
  const stopsById = new Map<string, TramStop>();
  // /stops is hit on every page load with a payload that changes at most once
  // a day. Cache the serialized body so we skip JSON.stringify per request.
  let stopsJson = "[]";
  // Coalesce concurrent identical lazy lookups for the same stop's departures.
  const coalescer = createCoalescer<string, DeparturePayload[]>();

  if (opts.digitransit) {
    const digitransit = opts.digitransit;
    startRefillScheduler({
      intervalMs: refreshIntervalMs,
      gateMs: refreshGateMs,
      label: "stop-cache",
      now: opts.now,
      refill: async () => {
        try {
          const fetched = await digitransit.listTramStops();
          stopsById.clear();
          for (const s of fetched) stopsById.set(s.id, s);
          stopsJson = JSON.stringify(fetched);
          console.log(`[stop-cache] refreshed ${fetched.length} stops`);
          return true;
        } catch (err) {
          console.error(
            `[stop-cache] stop list fetch failed (will retry in ${refreshIntervalMs / 1000}s):`,
            (err as Error).message,
          );
          return false;
        }
      },
    });
  }

  const router = Router();
  router.get(stopsPath, (_req: Request, res: Response) => {
    res.type("application/json").send(stopsJson);
  });

  router.get(departuresPath, async (req: Request, res: Response) => {
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

    const digitransit = opts.digitransit;
    try {
      const departures = await coalescer.run(stopId, async () => {
        const raw = await digitransit.fetchStopDepartures(stopId);
        // strip headsign — server-only metadata, see DeparturePayload
        return raw.map((d) => ({ line: d.line, departureAt: d.departureAt }));
      });
      res.json(departures);
    } catch (err) {
      console.error(`[stop-cache] departures fetch failed for ${stopId}:`, (err as Error).message);
      res.json([]);
    }
  });

  return { router };
}
