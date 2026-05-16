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
import type { Mode } from "./types.ts";
import { settings } from "./settings.ts";

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
  console.warn("[digitransit] DIGITRANSIT_API_KEY not set — route overlays and stops disabled");
}
const digitransit = settings.digitransitApiKey
  ? createDigitransitClient(settings.digitransitApiKey)
  : null;

interface ModePipeline {
  mode: Mode;
  state: State;
  mqtt: MqttClientHandle;
  dispose: () => void;
}

function startModePipeline(mode: Mode): ModePipeline {
  const state = createState({ evictAfterMs: settings.evictMs });
  const sse = startSseServer({ state, path: `/${mode}/events` });
  const routeCache = startRouteCache({ digitransit, mode });
  const stopCache = startStopCache({ digitransit, mode });
  app.use(sse.router);
  app.use(routeCache.router);
  app.use(stopCache.router);

  const mqtt = startMqttClient({
    state,
    mode,
    onConnect: () => console.log(`[mqtt:${mode}] subscribed to HSL ${mode} feed`),
    onError: (err) => console.error(`[mqtt:${mode}] error:`, err.message),
  });

  return {
    mode,
    state,
    mqtt,
    dispose: () => {
      sse.dispose();
      routeCache.dispose();
      stopCache.dispose();
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

const server = app.listen(settings.port, () => {
  console.log(`[http] listening on http://localhost:${settings.port}`);
});

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, closing gracefully`);

  const forceExit = setTimeout(() => {
    console.warn("[shutdown] forcing exit after timeout");
    process.exit(1);
  }, 10_000);

  for (const p of pipelines) p.dispose();
  server.close((err) => {
    if (err) console.error("[shutdown] http close error:", err.message);
  });
  Promise.allSettled(pipelines.map((p) => p.mqtt.end()))
    .then((results) => {
      for (const r of results) {
        if (r.status === "rejected") {
          console.error(
            "[shutdown] mqtt end error:",
            r.reason instanceof Error ? r.reason.message : r.reason,
          );
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
