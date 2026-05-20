import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createState, type State } from "./state.ts";
import { startMqttClient, type MqttClientHandle } from "./mqtt-client.ts";
import { startSseServer } from "./sse-server.ts";
import { startRouteCache } from "./route-cache.ts";
import { startStopCache } from "./stop-cache.ts";
import { createDigitransitClient } from "./digitransit-client.ts";
import { createLocalizedIndex } from "./localized-index.ts";
import { createTileProxy } from "./tile-proxy.ts";
import type { Mode } from "./types.ts";
import { settings } from "./settings.ts";
import { logger } from "./logger.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

const publicDir = join(__dirname, "..", "public");
// Mount the localized index router BEFORE static so it wins for `/`,
// `/fi`, `/en`. `index: false` keeps express.static from serving
// public/index.html directly for `/`.
const localizedIndex = createLocalizedIndex({ publicDir });
app.use(localizedIndex.router);
app.use(express.static(publicDir, { index: false }));
app.use(
  "/vendor/leaflet",
  express.static(join(__dirname, "..", "node_modules", "leaflet", "dist"), {
    maxAge: "1d",
  }),
);

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
