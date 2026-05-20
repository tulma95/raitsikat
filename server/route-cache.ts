import { Router, type Request, type Response } from "express";
import type { DigitransitClient } from "./digitransit-client.ts";
import type { Mode } from "./types.ts";
import type { Logger } from "./logger.ts";
import { createCoalescer, startRefillScheduler } from "./cache-helpers.ts";

export interface RouteCacheOptions {
  digitransit: DigitransitClient | null;
  mode: Mode;
  logger: Logger;
  path?: string;
  refreshIntervalMs?: number;
  refreshGateMs?: number;
  now?: () => number;
}

export interface RouteCacheHandle {
  router: Router;
  dispose: () => void;
}

export function startRouteCache(opts: RouteCacheOptions): RouteCacheHandle {
  const path = opts.path ?? `/${opts.mode}/route`;
  const label = `route-cache:${opts.mode}`;
  const log = opts.logger;
  const refreshIntervalMs = opts.refreshIntervalMs ?? 5 * 60 * 1000;
  const refreshGateMs = opts.refreshGateMs ?? 24 * 60 * 60 * 1000;

  const cache = new Map<string, string>(); // key: `${routeId}/${dirId}` -> encoded polyline
  // Set of published GTFS route ids (e.g. "HSL:1004", "HSL:1004H", "HSL:100H").
  // The HFP feed often reports operational variant ids ("HSL:1004H6", "HSL:100HA5")
  // that aren't in GTFS; we normalize those to the longest known prefix.
  const knownRouteIds = new Set<string>();
  // Coalesce concurrent identical lazy lookups so N parallel cache-miss requests
  // for the same route hit Digitransit only once.
  const coalescer = createCoalescer<string, string | null>();

  const key = (routeId: string, dirId: 1 | 2) => `${routeId}/${dirId}`;

  function normalizeRouteId(id: string): string {
    if (knownRouteIds.has(id)) return id;
    let best = "";
    for (const known of knownRouteIds) {
      if (id.startsWith(known) && known.length > best.length) best = known;
    }
    return best || id; // empty knownRouteIds (pre-warmup) → fall back to original
  }

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
        let allOk = true;
        let updated = 0;
        try {
          const routes = await digitransit.listRoutes(opts.mode);
          knownRouteIds.clear();
          for (const r of routes) knownRouteIds.add(r.id);
          for (const route of routes) {
            for (const dir of [1, 2] as const) {
              try {
                const poly = await digitransit.fetchPatternGeometry(route.id, dir);
                if (poly) {
                  cache.set(key(route.id, dir), poly);
                  updated++;
                }
              } catch (err) {
                allOk = false;
                log.error("pattern fetch failed", {
                  routeId: route.id,
                  dir,
                  err,
                });
              }
            }
          }
        } catch (err) {
          allOk = false;
          log.error("route list fetch failed", { err });
        }

        if (allOk) {
          log.info("refreshed patterns", { updated, cacheSize: cache.size });
        } else if (updated > 0) {
          log.warn("partial refresh, will retry", {
            updated,
            retryInSec: refreshIntervalMs / 1000,
          });
        } else {
          log.warn("refresh failed, will retry", {
            retryInSec: refreshIntervalMs / 1000,
          });
        }
        return allOk;
      },
    });
  }

  const router = Router();
  router.get(path, async (req: Request, res: Response) => {
    const routeId = typeof req.query.id === "string" ? req.query.id : "";
    const dirRaw = typeof req.query.dir === "string" ? req.query.dir : "";
    if (!routeId) {
      res.status(400).json({ error: "missing id" });
      return;
    }
    if (dirRaw !== "1" && dirRaw !== "2") {
      res.status(400).json({ error: "dir must be 1 or 2" });
      return;
    }
    const dirId = dirRaw === "1" ? 1 : 2;
    const lookupId = normalizeRouteId(routeId);

    const cached = cache.get(key(lookupId, dirId));
    if (cached) {
      res.json({ polyline: cached });
      return;
    }

    if (!opts.digitransit) {
      res.json({ polyline: null });
      return;
    }

    // Only allow lazy Digitransit calls for routes we've published via warmup.
    // Without this gate, an attacker could spam arbitrary ids and burn quota.
    if (!knownRouteIds.has(lookupId)) {
      res.json({ polyline: null });
      return;
    }

    const lookupKey = key(lookupId, dirId);
    const digitransit = opts.digitransit;
    try {
      const poly = await coalescer.run(lookupKey, async () => {
        const result = await digitransit.fetchPatternGeometry(lookupId, dirId);
        if (result) cache.set(lookupKey, result);
        return result ?? null;
      });
      res.json({ polyline: poly });
    } catch (err) {
      log.error("lazy fetch failed", { routeId: lookupId, dir: dirId, err });
      res.json({ polyline: null });
    }
  });

  return {
    router,
    dispose: () => scheduler?.stop(),
  };
}
