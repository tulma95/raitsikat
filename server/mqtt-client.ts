import mqtt from "mqtt";
import type { State } from "./state.ts";
import type { Vehicle } from "./types.ts";

export interface MqttClientOptions {
  url?: string;
  topic?: string;
  state: State;
  onConnect?: () => void;
  onError?: (err: Error) => void;
}

interface HfpPayload {
  VP?: {
    desi?: string;
    oper?: number;
    veh?: number;
    lat?: number;
    long?: number;
    hdg?: number;
  };
}

export function startMqttClient(opts: MqttClientOptions): mqtt.MqttClient {
  const url = opts.url ?? "mqtts://mqtt.hsl.fi:8883";
  const topic = opts.topic ?? "/hfp/v2/journey/ongoing/vp/tram/#";

  const client = mqtt.connect(url, { reconnectPeriod: 2000 });

  client.on("connect", () => {
    client.subscribe(topic, (err) => {
      if (err) opts.onError?.(err);
      else opts.onConnect?.();
    });
  });

  client.on("error", (err) => opts.onError?.(err));

  client.on("message", (_topic, payload) => {
    const vehicle = parseMessage(payload);
    if (vehicle) opts.state.upsert(vehicle);
  });

  return client;
}

export function parseMessage(payload: Buffer): Vehicle | null {
  let data: HfpPayload;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return null;
  }
  const vp = data.VP;
  if (!vp) return null;
  if (typeof vp.lat !== "number" || typeof vp.long !== "number") return null;
  if (typeof vp.oper !== "number" || typeof vp.veh !== "number") return null;
  if (typeof vp.desi !== "string") return null;

  return {
    id: `${vp.oper}/${vp.veh}`,
    line: vp.desi,
    lat: vp.lat,
    lon: vp.long,
    heading: typeof vp.hdg === "number" ? vp.hdg : 0,
    updatedAt: Date.now(),
  };
}
