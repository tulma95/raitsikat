import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createState } from "./state.ts";
import { startMqttClient } from "./mqtt-client.ts";
import { startSseServer } from "./sse-server.ts";
import { startRouteCache } from "./route-cache.ts";
import { startStopCache } from "./stop-cache.ts";
import { createDigitransitClient } from "./digitransit-client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const EVICT_MS = 60_000;
const EVICT_INTERVAL_MS = 10_000;
const MQTT_LIVENESS_MS = 60_000;

const state = createState({ evictAfterMs: EVICT_MS });
setInterval(() => state.evict(), EVICT_INTERVAL_MS).unref();

const app = express();
app.use(express.static(join(__dirname, "..", "public")));

const sse = startSseServer({ app, state });

const apiKey = process.env.DIGITRANSIT_API_KEY;
if (!apiKey) {
  console.warn("[digitransit] DIGITRANSIT_API_KEY not set — route overlays and stops disabled");
}
const digitransit = apiKey ? createDigitransitClient(apiKey) : null;
startRouteCache({ app, digitransit });
startStopCache({ app, digitransit });

const mqttClient = startMqttClient({
  state,
  onConnect: () => console.log("[mqtt] subscribed to HSL tram feed"),
  onError: (err) => console.error("[mqtt] error:", err.message),
});

app.get("/healthz", (_req, res) => {
  const lastMessageAt = mqttClient.lastMessageAt;
  const lastMqttMessageAt = lastMessageAt ? new Date(lastMessageAt).toISOString() : null;
  const fresh =
    mqttClient.connected &&
    lastMessageAt !== null &&
    Date.now() - lastMessageAt < MQTT_LIVENESS_MS;
  res.status(fresh ? 200 : 503).json({
    mqttConnected: mqttClient.connected,
    vehicleCount: state.snapshot().length,
    lastMqttMessageAt,
  });
});

const server = app.listen(PORT, () => {
  console.log(`[http] listening on http://localhost:${PORT}`);
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

  sse.dispose();
  server.close((err) => {
    if (err) console.error("[shutdown] http close error:", err.message);
  });
  mqttClient
    .end()
    .catch((err: unknown) =>
      console.error("[shutdown] mqtt end error:", err instanceof Error ? err.message : err),
    )
    .finally(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
