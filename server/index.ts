import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createState, type State } from "./state.ts";
import { startMqttClient, type MqttClientHandle } from "./mqtt-client.ts";
import { startSseServer } from "./sse-server.ts";
import { startRouteCache } from "./route-cache.ts";
import { startStopCache } from "./stop-cache.ts";
import { createDigitransitClient } from "./digitransit-client.ts";
import { createTileProxy } from "./tile-proxy.ts";
import type { Mode } from "./types.ts";
import { settings } from "./settings.ts";
import { logger } from "./logger.ts";
// @ts-expect-error generated Astro middleware entry, built by `astro build`, no types
import { handler as ssrHandler } from "../dist/server/entry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

// Astro is configured with `trailingSlash: "never"`, so `/ratikat/` would
// 404 in the SSR handler. 301 any GET path ending in "/" (except "/"
// itself) to the slashless form, preserving the query string. Leading
// slashes are collapsed too so `//host/` can't become a protocol-relative
// open redirect.
app.use((req, res, next) => {
  const queryStart = req.originalUrl.indexOf("?");
  const path = queryStart === -1 ? req.originalUrl : req.originalUrl.slice(0, queryStart);
  if (req.method !== "GET" || path.length <= 1 || !path.endsWith("/")) {
    next();
    return;
  }
  const search = queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
  const target = "/" + path.replace(/^\/+|\/+$/g, "");
  res.redirect(301, target + search);
});

// `/`, `/en`, `/fi`, `/sitemap.xml` are owned by the Astro SSR handler
// (mounted last). Static assets are served from the Astro build's client
// dir; `index: false` keeps express.static from ever answering `/` with a
// stray index.html (Astro must own `/`).
app.use(express.static(join(__dirname, "..", "dist", "client"), { index: false }));

if (!settings.digitransitApiKey) {
  logger
    .child({ component: "digitransit" })
    .warn("DIGITRANSIT_API_KEY not set — route overlays and stops disabled");
}
const digitransit = settings.digitransitApiKey
  ? createDigitransitClient(settings.digitransitApiKey)
  : null;

if (settings.digitransitApiKey) {
  const tiles = createTileProxy({
    apiKey: settings.digitransitApiKey,
    logger: logger.child({ component: "tile-proxy" }),
  });
  app.use(tiles.router);
}

interface ModePipeline {
  mode: Mode;
  state: State;
  mqtt: MqttClientHandle;
  dispose: () => void;
}

function startModePipeline(mode: Mode): ModePipeline {
  const modeLog = logger.child({ mode });
  const state = createState({
    evictAfterMs: settings.evictMs,
    coalesceMs: settings.sseCoalesceMs,
  });
  const sse = startSseServer({ state, path: `/${mode}/events` });
  const routeCache = startRouteCache({
    digitransit,
    mode,
    logger: modeLog.child({ component: "route-cache" }),
  });
  const stopCache = startStopCache({
    digitransit,
    mode,
    logger: modeLog.child({ component: "stop-cache" }),
  });
  app.use(sse.router);
  app.use(routeCache.router);
  app.use(stopCache.router);

  const mqttLog = modeLog.child({ component: "mqtt" });
  const mqtt = startMqttClient({
    state,
    mode,
    onConnect: () => mqttLog.info("subscribed to HSL feed"),
    onError: (err) => mqttLog.error("mqtt error", { err }),
  });

  return {
    mode,
    state,
    mqtt,
    dispose: () => {
      sse.dispose();
      routeCache.dispose();
      stopCache.dispose();
      state.dispose();
    },
  };
}

const pipelines: ModePipeline[] = [
  startModePipeline("tram"),
  startModePipeline("bus"),
];

setInterval(() => {
  for (const p of pipelines) p.state.evict();
}, settings.evictIntervalMs).unref();

app.get("/healthz", (_req, res) => {
  const modes = Object.fromEntries(
    pipelines.map((p) => {
      const lastMessageAt = p.mqtt.lastMessageAt;
      return [
        p.mode,
        {
          mqttConnected: p.mqtt.connected,
          vehicleCount: p.state.snapshot().length,
          lastMqttMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
        },
      ];
    }),
  );
  const fresh = pipelines.every(
    (p) =>
      p.mqtt.connected &&
      p.mqtt.lastMessageAt !== null &&
      Date.now() - p.mqtt.lastMessageAt < settings.mqttLivenessMs,
  );
  res.status(fresh ? 200 : 503).json(modes);
});

// Astro SSR handler is mounted LAST: it owns only `/`, `/en`, `/fi`,
// `/sitemap.xml` and calls next() for everything else, so all backend
// routers above (tiles, SSE, route, stops, healthz) win.
app.use(ssrHandler);

const httpLog = logger.child({ component: "http" });
const server = app.listen(settings.port, () => {
  httpLog.info("listening", {
    port: settings.port,
    url: `http://localhost:${settings.port}`,
  });
});

const shutdownLog = logger.child({ component: "shutdown" });
let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownLog.info("received signal, closing gracefully", { signal });

  const forceExit = setTimeout(() => {
    shutdownLog.warn("forcing exit after timeout");
    process.exit(1);
  }, 10_000);

  for (const p of pipelines) p.dispose();
  server.close((err) => {
    if (err) shutdownLog.error("http close error", { err });
  });
  Promise.allSettled(pipelines.map((p) => p.mqtt.end()))
    .then((results) => {
      for (const r of results) {
        if (r.status === "rejected") {
          shutdownLog.error("mqtt end error", { err: r.reason });
        }
      }
    })
    .finally(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
