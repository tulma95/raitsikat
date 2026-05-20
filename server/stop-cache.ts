import { Router, type Request, type Response } from "express";
import type { DigitransitClient, StopDeparture, Stop } from "./digitransit-client.ts";
import type { Mode } from "./types.ts";
import type { Logger } from "./logger.ts";
import { createCoalescer, startRefillScheduler } from "./cache-helpers.ts";

export interface StopCacheOptions {
  digitransit: DigitransitClient | null;
  mode: Mode;
  logger: Logger;
  stopsPath?: string;
  departuresPath?: string;
  refreshIntervalMs?: number;
  refreshGateMs?: number;
  now?: () => number;
}

export interface StopCacheHandle {
  router: Router;
  dispose: () => void;
}

// `headsign` is server-only metadata; strip before sending so the wire payload
// matches the spec.
type DeparturePayload = Pick<StopDeparture, "line" | "departureAt">;

export function startStopCache(opts: StopCacheOptions): StopCacheHandle {
  const stopsPath = opts.stopsPath ?? `/${opts.mode}/stops`;
  const departuresPath = opts.departuresPath ?? `/${opts.mode}/departures`;
  const label = `stop-cache:${opts.mode}`;
  const log = opts.logger;
  const refreshIntervalMs = opts.refreshIntervalMs ?? 5 * 60 * 1000;
  const refreshGateMs = opts.refreshGateMs ?? 24 * 60 * 60 * 1000;

  // Single source of truth — serves both the /stops list (via cached JSON) and
  // the /departures known-id gate (via .has()).
  const stopsById = new Map<string, Stop>();
  // /stops is hit on every page load with a payload that changes at most once
  // a day. Cache the serialized body so we skip JSON.stringify per request.
  let stopsJson = "[]";
  // Coalesce concurrent identical lazy lookups for the same stop's departures.
  const coalescer = createCoalescer<string, DeparturePayload[]>();

  let scheduler: { stop: () => void } | null = null;
  if (opts.digitransit) {
    const digitransit = opts.digitransit;
    scheduler = startRefillScheduler({
      intervalMs: refreshIntervalMs,
      gateMs: refreshGateMs,
      label,
      logger: log,
      now: opts.now,
      refill: async () => {
        try {
          const fetched = await digitransit.listStops(opts.mode);
          stopsById.clear();
          for (const s of fetched) stopsById.set(s.id, s);
          stopsJson = JSON.stringify(fetched);
          log.info("refreshed stops", { count: fetched.length });
          return true;
        } catch (err) {
          log.error("stop list fetch failed, will retry", {
            retryInSec: refreshIntervalMs / 1000,
            err,
          });
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
        const raw = await digitransit.fetchStopDepartures(stopId, opts.mode);
        // strip headsign — server-only metadata, see DeparturePayload
        return raw.map((d) => ({ line: d.line, departureAt: d.departureAt }));
      });
      res.json(departures);
    } catch (err) {
      log.error("departures fetch failed", { stopId, err });
      res.json([]);
    }
  });

  return {
    router,
    dispose: () => scheduler?.stop(),
  };
}
