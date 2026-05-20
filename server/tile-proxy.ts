import { Router, type Request, type Response } from "express";
import sharp from "sharp";

// Only styles in this allowlist are proxied. Prevents the route from
// becoming an open relay onto arbitrary Digitransit endpoints.
const ALLOWED_STYLES = new Set(["hsl-map"]);

// Matches the client's Leaflet config in public/js/map.js (minZoom: 11,
// maxZoom: 19). Out-of-range coordinates are rejected before we burn
// upstream quota.
const MIN_ZOOM = 11;
const MAX_ZOOM = 19;

const UPSTREAM_BASE = "https://cdn.digitransit.fi/map/v3";

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
}

export interface TileProxyHandle {
  router: Router;
}

export function createTileProxy(opts: TileProxyOptions): TileProxyHandle {
  const router = Router();

  // Register the @2x route FIRST. path-to-regexp's `:y` capture is
  // non-greedy and the `.png` literal is shared between both routes, so
  // if the plain route were registered first, a request like
  // `/tiles/hsl-map/13/4660/2378@2x.png` would match it with
  // `:y = "2378@2x"` and the response would silently be a non-retina
  // tile.
  router.get("/tiles/:style/:z/:x/:y@2x.png", (req, res) => {
    void handleTile(req, res, opts.apiKey, "@2x");
  });
  router.get("/tiles/:style/:z/:x/:y.png", (req, res) => {
    void handleTile(req, res, opts.apiKey, "");
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

  const url = `${UPSTREAM_BASE}/${tilePath}.png`;
  try {
    const upstream = await fetch(url, {
      headers: { "digitransit-subscription-key": apiKey },
    });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const pngBuf = Buffer.from(await upstream.arrayBuffer());

    let body: Buffer;
    let contentType: string;
    if (wantWebp) {
      try {
        body = await sharp(pngBuf)
          .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
          .toBuffer();
        contentType = "image/webp";
      } catch (err) {
        // Fall back to PNG if transcode fails so the map still renders.
        console.error(
          "[tile-proxy] webp transcode failed:",
          err instanceof Error ? err.message : err,
        );
        body = pngBuf;
        contentType = upstream.headers.get("content-type") ?? "image/png";
      }
    } else {
      body = pngBuf;
      contentType = upstream.headers.get("content-type") ?? "image/png";
    }

    cacheSet(cacheKey, { body, contentType });

    res.status(200);
    res.setHeader("Content-Type", contentType);
    res.send(body);
  } catch (err) {
    console.error(
      "[tile-proxy] upstream error:",
      err instanceof Error ? err.message : err,
    );
    res.status(502).end();
  }
}
