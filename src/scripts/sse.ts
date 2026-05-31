// SSE wiring: subscribes to /{mode}/events and routes typed events into the
// vehicles model. The server is trusted, but we still guard JSON.parse
// per event so a single malformed payload doesn't throw into the event
// listener and drop the update silently to the console.
//
// `window.__perfHooks`, if set (only when ?perf=1 is in the URL), receives
// notifications for every parsed event. Kept on a global because perf.js
// loads lazily and we don't want to import it eagerly.

import { handleSnapshot, upsertVehicle, removeVehicle } from "./vehicles.ts";
import { trackConnection } from "./connection.ts";
import type { Mode } from "../../server/types.ts";
import { isVehicle } from "./types.ts";

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function notePerf(kind: string, byteLen: number, count: number): void {
  const hooks = window.__perfHooks;
  if (!hooks) return;
  hooks.note(kind, byteLen, count);
}

export function connect(mode: Mode): EventSource {
  const es = new EventSource(`/${mode}/events`);
  trackConnection(es);
  es.addEventListener("snapshot", (ev) => {
    if (!(ev instanceof MessageEvent) || typeof ev.data !== "string") return;
    const data: string = ev.data;
    const parsed = safeParse(data);
    if (typeof parsed === "object" && parsed !== null && "vehicles" in parsed && Array.isArray(parsed.vehicles)) {
      const vehicles = parsed.vehicles.filter(isVehicle);
      notePerf("snapshot", data.length, vehicles.length);
      handleSnapshot(vehicles);
    }
  });
  es.addEventListener("update", (ev) => {
    if (!(ev instanceof MessageEvent) || typeof ev.data !== "string") return;
    const data: string = ev.data;
    const parsed = safeParse(data);
    if (typeof parsed === "object" && parsed !== null && "vehicle" in parsed && isVehicle(parsed.vehicle)) {
      notePerf("update", data.length, 1);
      upsertVehicle(parsed.vehicle);
    }
  });
  es.addEventListener("remove", (ev) => {
    if (!(ev instanceof MessageEvent) || typeof ev.data !== "string") return;
    const data: string = ev.data;
    const parsed = safeParse(data);
    if (typeof parsed === "object" && parsed !== null && "id" in parsed && typeof parsed.id === "string") {
      notePerf("remove", data.length, 1);
      removeVehicle(parsed.id);
    }
  });
  return es;
}
