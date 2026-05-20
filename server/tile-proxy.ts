import { Router, type Request, type Response } from "express";
import sharp from "sharp";
import type { Logger } from "./logger.ts";

// Only styles in this allowlist are proxied. Prevents the route from
// becoming an open relay onto arbitrary Digitransit endpoints.
const ALLOWED_STYLES = new Set(["hsl-map"]);

// Server-side coordinate bounds. MIN_ZOOM is 11 because the client's
// Leaflet config in public/js/map.js sets `zoomOffset: -1` with a view
// minZoom of 12, so the lowest tile zoom actually requested upstream
// is 11. MAX_ZOOM mirrors the client's maxZoom. Out-of-range
// coordinates are rejected before we burn upstream quota.
const MIN_ZOOM = 11;
const MAX_ZOOM = 19;

const UPSTREAM_BASE = "https://cdn.digitransit.fi/map/v3";

// Cap how long we wait on Digitransit before giving up. Without this
// the upstream `fetch` has no timeout and a stalled CDN keeps requests
// (and event-loop slots / sockets) pinned indefinitely.
const UPSTREAM_TIMEOUT_MS = 5000;

// Digitransit's v3 raster endpoint returns PNG only. Modern browsers
// advertise `image/webp` in Accept; transcode for them and cache the
// result so the conversion cost is paid once per tile per process.
const WEBP_QUALITY = 80;
const WEBP_EFFORT = 4;
const CACHE_MAX_ENTRIES = 2048;

interface CachedTile {
  body: Buffer;
  contentType: string;
}

// Simple LRU via Map insertion order. Tile bodies are ~10-50 KB, so
// 2048 entries ≈ 40-100 MB worst case — well within a server-side
// budget and bounded.
const tileCache = new Map<string, CachedTile>();

// Request coalescing: when N clients hit the same uncached tile
// concurrently, only one upstream fetch + transcode runs. Without this
// a fresh viewport could fan out into dozens of identical upstream
// calls and burn Digitransit quota / CPU. Entry is removed once the
// promise settles, so memory stays bounded by concurrency, not cache
// size.
type FetchResult =
  | { ok: true; tile: CachedTile }
  | { ok: false; status: number };
const inflight = new Map<string, Promise<FetchResult>>();

function cacheGet(key: string): CachedTile | undefined {
  const hit = tileCache.get(key);
  if (!hit) return undefined;
  tileCache.delete(key);
  tileCache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: CachedTile): void {
  if (tileCache.has(key)) tileCache.delete(key);
  tileCache.set(key, value);
  while (tileCache.size > CACHE_MAX_ENTRIES) {
    const oldest = tileCache.keys().next().value;
    if (oldest === undefined) break;
    tileCache.delete(oldest);
  }
}

export interface TileProxyOptions {
  apiKey: string;
  logger: Logger;
}

export interface TileProxyHandle {
  router: Router;
}

export function createTileProxy(opts: TileProxyOptions): TileProxyHandle {
  const router = Router();
  const log = opts.logger;

  // Register the @2x route FIRST. path-to-regexp's `:y` capture is
  // non-greedy and the `.png` literal is shared between both routes, so
  // if the plain route were registered first, a request like
  // `/tiles/hsl-map/13/4660/2378@2x.png` would match it with
  // `:y = "2378@2x"` and the response would silently be a non-retina
  // tile.
  router.get("/tiles/:style/:z/:x/:y@2x.png", (req, res) => {
    void handleTile(req, res, opts.apiKey, "@2x", log);
  });
  router.get("/tiles/:style/:z/:x/:y.png", (req, res) => {
    void handleTile(req, res, opts.apiKey, "", log);
  });

  return { router };
}

const DIGITS = /^\d+$/;

function acceptsWebp(req: Request): boolean {
  const header = req.headers.accept;
  if (typeof header !== "string") return false;
  return header.includes("image/webp");
}

async function handleTile(
  req: Request,
  res: Response,
  apiKey: string,
  retina: "" | "@2x",
  log: Logger,
): Promise<void> {
  // Express 5's param types are `string | string[]`; these routes only
  // ever produce scalars, but narrow defensively so a malformed capture
  // can't reach validation as an array.
  const style = req.params.style;
  const zRaw = req.params.z;
  const xRaw = req.params.x;
  const yRaw = req.params.y;
  if (
    typeof style !== "string" ||
    typeof zRaw !== "string" ||
    typeof xRaw !== "string" ||
    typeof yRaw !== "string"
  ) {
    res.status(400).end();
    return;
  }
  if (!ALLOWED_STYLES.has(style)) {
    res.status(404).end();
    return;
  }

  // Strict digit-only check; Number.parseInt is too lenient
  // ("2378@2x" → 2378), which would let polluted captures from the
  // non-retina route slip past if the registration order ever changes.
  if (!DIGITS.test(zRaw) || !DIGITS.test(xRaw) || !DIGITS.test(yRaw)) {
    res.status(400).end();
    return;
  }
  const z = Number.parseInt(zRaw, 10);
  const x = Number.parseInt(xRaw, 10);
  const y = Number.parseInt(yRaw, 10);
  const tilesAtZ = 2 ** z;
  if (z < MIN_ZOOM || z > MAX_ZOOM || x >= tilesAtZ || y >= tilesAtZ) {
    res.status(400).end();
    return;
  }

  const wantWebp = acceptsWebp(req);
  const tilePath = `${style}/${z}/${x}/${y}${retina}`;
  const cacheKey = `${wantWebp ? "webp" : "png"}:${tilePath}`;

  // Vary so a shared cache (CDN, intermediary) keeps WebP and PNG
  // variants apart for clients that disagree on Accept.
  res.setHeader("Vary", "Accept");
  res.setHeader("Cache-Control", "public, max-age=86400");

  const cached = cacheGet(cacheKey);
  if (cached) {
    res.status(200);
    res.setHeader("Content-Type", cached.contentType);
    res.send(cached.body);
    return;
  }

  let promise = inflight.get(cacheKey);
  if (!promise) {
    promise = fetchAndPrepare(cacheKey, wantWebp, tilePath, apiKey, log);
    inflight.set(cacheKey, promise);
    // Clear the in-flight entry once it settles so future cache
    // misses can refetch (e.g. after eviction). Use a detached
    // handler so awaiters see the original result/rejection.
    promise.finally(() => {
      if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey);
    });
  }

  const result = await promise;
  if (!result.ok) {
    res.status(result.status).end();
    return;
  }
  res.status(200);
  res.setHeader("Content-Type", result.tile.contentType);
  res.send(result.tile.body);
}

async function fetchAndPrepare(
  cacheKey: string,
  wantWebp: boolean,
  tilePath: string,
  apiKey: string,
  log: Logger,
): Promise<FetchResult> {
  const url = `${UPSTREAM_BASE}/${tilePath}.png`;
  try {
    const upstream = await fetch(url, {
      headers: { "digitransit-subscription-key": apiKey },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      return { ok: false, status: upstream.status };
    }
    const pngBuf = Buffer.from(await upstream.arrayBuffer());

    if (wantWebp) {
      try {
        const body = await sharp(pngBuf)
          .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
          .toBuffer();
        const tile: CachedTile = { body, contentType: "image/webp" };
        cacheSet(cacheKey, tile);
        return { ok: true, tile };
      } catch (err) {
        // Transcode failures may be transient (OOM, libvips hiccup).
        // Serve PNG for this request, but DON'T cache it under the
        // webp key — otherwise a single failure poisons the slot for
        // the lifetime of the process.
        log.error("webp transcode failed", { tilePath, err });
        return {
          ok: true,
          tile: { body: pngBuf, contentType: "image/png" },
        };
      }
    }

    const tile: CachedTile = {
      body: pngBuf,
      contentType: upstream.headers.get("content-type") ?? "image/png",
    };
    cacheSet(cacheKey, tile);
    return { ok: true, tile };
  } catch (err) {
    log.error("upstream error", { tilePath, err });
    return { ok: false, status: 502 };
  }
}
