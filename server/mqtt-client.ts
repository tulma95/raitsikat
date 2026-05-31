import mqtt from "mqtt";
import type { State } from "./state.ts";
import type { Mode, Vehicle } from "./types.ts";

export interface MqttClientOptions {
  url?: string;
  topic?: string;
  mode: Mode;
  state: State;
  onConnect?: () => void;
  onError?: (err: Error) => void;
}

export interface MqttClientHandle {
  client: mqtt.MqttClient;
  readonly connected: boolean;
  readonly lastMessageAt: number | null;
  end: () => Promise<void>;
}

export function startMqttClient(opts: MqttClientOptions): MqttClientHandle {
  const url = opts.url ?? "mqtts://mqtt.hsl.fi:8883";
  const topic = opts.topic ?? `/hfp/v2/journey/ongoing/vp/${opts.mode}/#`;

  const client = mqtt.connect(url, { reconnectPeriod: 2000 });
  let lastMessageAt: number | null = null;

  client.on("connect", () => {
    client.subscribe(topic, (err) => {
      if (err) opts.onError?.(err);
      else opts.onConnect?.();
    });
  });

  client.on("error", (err) => opts.onError?.(err));

  client.on("message", (topic, payload) => {
    const now = Date.now();
    lastMessageAt = now;
    const vehicle = parseMessage(topic, payload, now);
    if (vehicle) opts.state.upsert(vehicle);
  });

  return {
    client,
    get connected() {
      return client.connected;
    },
    get lastMessageAt() {
      return lastMessageAt;
    },
    end: () =>
      new Promise<void>((resolve) => {
        client.end(false, {}, () => resolve());
      }),
  };
}

export function parseMessage(topic: string, payload: Buffer, now: number): Vehicle | null {
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
  if (!/^\d/.test(rawRouteId)) return null;
  if (rawDir !== "1" && rawDir !== "2") return null;

  let data: unknown;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || !("VP" in data)) return null;
  const vp = data.VP;
  if (typeof vp !== "object" || vp === null) return null;
  if (!("lat" in vp) || typeof vp.lat !== "number") return null;
  if (!("long" in vp) || typeof vp.long !== "number") return null;
  if (!("oper" in vp) || typeof vp.oper !== "number") return null;
  if (!("veh" in vp) || typeof vp.veh !== "number") return null;
  if (!("desi" in vp) || typeof vp.desi !== "string") return null;
  if (!("hdg" in vp) || typeof vp.hdg !== "number") return null;

  return {
    id: `${vp.oper}/${vp.veh}`,
    line: vp.desi,
    routeId: `HSL:${rawRouteId}`,
    directionId: rawDir === "1" ? 1 : 2,
    lat: vp.lat,
    lon: vp.long,
    heading: vp.hdg,
    updatedAt: now,
  };
}
