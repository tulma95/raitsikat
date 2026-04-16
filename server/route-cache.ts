import type { Express, Request, Response } from "express";
import type { DigitransitClient } from "./digitransit-client.ts";

export interface RouteCacheOptions {
  app: Express;
  digitransit: DigitransitClient | null;
  path?: string;
  refreshIntervalMs?: number;
  refreshGateMs?: number;
  now?: () => number;
}

export function startRouteCache(opts: RouteCacheOptions): void {
  const path = opts.path ?? "/route";
  const refreshIntervalMs = opts.refreshIntervalMs ?? 5 * 60 * 1000;
  const refreshGateMs = opts.refreshGateMs ?? 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now;

  const cache = new Map<string, string>(); // key: `${routeId}/${dirId}` -> encoded polyline
  // Set of published GTFS route ids (e.g. "HSL:1004", "HSL:1004H", "HSL:100H").
  // The HFP feed often reports operational variant ids ("HSL:1004H6", "HSL:100HA5")
  // that aren't in GTFS; we normalize those to the longest known prefix.
  const knownRouteIds = new Set<string>();
  let lastSuccessAt = 0;

  const key = (routeId: string, dirId: 1 | 2) => `${routeId}/${dirId}`;

  function normalizeRouteId(id: string): string {
    if (knownRouteIds.has(id)) return id;
    let best = "";
    for (const known of knownRouteIds) {
      if (id.startsWith(known) && known.length > best.length) best = known;
    }
    return best || id; // empty knownRouteIds (pre-warmup) → fall back to original
  }

  async function attemptRefill(): Promise<void> {
    if (!opts.digitransit) return;
    if (now() - lastSuccessAt < refreshGateMs) return;

    let allOk = true;
    let updated = 0;
    try {
      const routes = await opts.digitransit.listTramRoutes();
      knownRouteIds.clear();
      for (const r of routes) knownRouteIds.add(r.id);
      for (const route of routes) {
        for (const dir of [1, 2] as const) {
          try {
            const poly = await opts.digitransit.fetchPatternGeometry(route.id, dir);
            if (poly) {
              cache.set(key(route.id, dir), poly);
              updated++;
            }
          } catch (err) {
            allOk = false;
            console.error(`[route-cache] pattern fetch failed for ${route.id}/${dir}:`, (err as Error).message);
          }
        }
      }
    } catch (err) {
      allOk = false;
      console.error("[route-cache] route list fetch failed:", (err as Error).message);
    }

    if (allOk) {
      lastSuccessAt = now();
      console.log(`[route-cache] refreshed ${updated} patterns; cache size = ${cache.size}`);
    } else {
      console.warn(`[route-cache] partial refresh: updated ${updated} patterns, will retry in ${refreshIntervalMs / 1000}s`);
    }
  }

  // Kick off immediately, then poll on interval. The 24h gate inside attemptRefill
  // makes most ticks no-ops; this keeps us self-healing on transient failures.
  attemptRefill();
  const ticker = setInterval(attemptRefill, refreshIntervalMs);
  ticker.unref();

  opts.app.get(path, async (req: Request, res: Response) => {
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

    try {
      const poly = await opts.digitransit.fetchPatternGeometry(lookupId, dirId);
      if (poly) cache.set(key(lookupId, dirId), poly);
      res.json({ polyline: poly ?? null });
    } catch (err) {
      console.error(`[route-cache] lazy fetch failed for ${lookupId}/${dirId}:`, (err as Error).message);
      res.json({ polyline: null });
    }
  });
}
