import { Router, type Request, type Response } from "express";

// Only styles in this allowlist are proxied. Prevents the route from
// becoming an open relay onto arbitrary Digitransit endpoints.
const ALLOWED_STYLES = new Set(["hsl-map"]);

// Matches the client's Leaflet config in public/js/map.js (minZoom: 11,
// maxZoom: 19). Out-of-range coordinates are rejected before we burn
// upstream quota.
const MIN_ZOOM = 11;
const MAX_ZOOM = 19;

const UPSTREAM_BASE = "https://cdn.digitransit.fi/map/v3";

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

  const url = `${UPSTREAM_BASE}/${style}/${z}/${x}/${y}${retina}.png`;
  try {
    const upstream = await fetch(url, {
      headers: { "digitransit-subscription-key": apiKey },
    });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const contentType = upstream.headers.get("content-type") ?? "image/png";
    // Tiles are small (~10-50 KB); buffer rather than stream to keep
    // the proxy simple. Forwarding Cache-Control verbatim is avoided
    // because Digitransit's CDN can return short-lived or no-store
    // headers; a 24h browser cache is safe for raster tiles.
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(200);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch (err) {
    console.error(
      "[tile-proxy] upstream error:",
      err instanceof Error ? err.message : err,
    );
    res.status(502).end();
  }
}
