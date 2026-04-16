import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createState } from "./state.ts";
import { startMqttClient } from "./mqtt-client.ts";
import { startSseServer } from "./sse-server.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const EVICT_MS = 60_000;
const EVICT_INTERVAL_MS = 10_000;

const state = createState({ evictAfterMs: EVICT_MS });
setInterval(() => state.evict(), EVICT_INTERVAL_MS).unref();

const app = express();
app.use(express.static(join(__dirname, "..", "public")));

startSseServer({ app, state });

startMqttClient({
  state,
  onConnect: () => console.log("[mqtt] subscribed to HSL tram feed"),
  onError: (err) => console.error("[mqtt] error:", err.message),
});

app.listen(PORT, () => {
  console.log(`[http] listening on http://localhost:${PORT}`);
});
