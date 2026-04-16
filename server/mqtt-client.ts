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

  client.on("message", (topic, payload) => {
    const vehicle = parseMessage(topic, payload);
    if (vehicle) opts.state.upsert(vehicle);
  });

  return client;
}

export function parseMessage(topic: string, payload: Buffer): Vehicle | null {
  // HFP v2 topic shape:
  // /hfp/v2/<journey_type>/<temporal_type>/<event_type>/<transport_mode>/<operator_id>/<vehicle_number>/<route_id>/<direction_id>/<headsign>/<start_time>/<next_stop>/<geohash_l>/<geohash>
  // After splitting on "/", index 0 is the empty string from the leading "/",
  // so segments are: [1]=hfp, [2]=v2, [3]=journey_type, [4]=temporal_type,
  // [5]=event_type, [6]=transport_mode, [7]=operator_id, [8]=vehicle_number,
  // [9]=route_id, [10]=direction_id, ...
  const parts = topic.split("/");
  const rawRouteId = parts[9];
  const rawDir = parts[10];
  if (!rawRouteId) return null;
  if (rawDir !== "1" && rawDir !== "2") return null;

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
    routeId: `HSL:${rawRouteId}`,
    directionId: rawDir === "1" ? 1 : 2,
    lat: vp.lat,
    lon: vp.long,
    heading: typeof vp.hdg === "number" ? vp.hdg : 0,
    updatedAt: Date.now(),
  };
}
