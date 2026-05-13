// SSE wiring: subscribes to /{mode}/events and routes typed events into the
// vehicles model. The server is trusted, but we still guard JSON.parse
// per event so a single malformed payload doesn't throw into the event
// listener and drop the update silently to the console.

import { handleSnapshot, upsertVehicle, removeVehicle } from "./vehicles.js";
import { trackConnection } from "./connection.js";

function safeParse(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function connect(mode) {
  const es = new EventSource(`/${mode}/events`);
  trackConnection(es);
  es.addEventListener("snapshot", (ev) => {
    /** @type {import("./types.js").SnapshotEvent | null} */
    const parsed = safeParse(ev.data);
    if (parsed && Array.isArray(parsed.vehicles)) handleSnapshot(parsed.vehicles);
  });
  es.addEventListener("update", (ev) => {
    /** @type {import("./types.js").UpdateEvent | null} */
    const parsed = safeParse(ev.data);
    if (parsed && parsed.vehicle) upsertVehicle(parsed.vehicle);
  });
  es.addEventListener("remove", (ev) => {
    /** @type {import("./types.js").RemoveEvent | null} */
    const parsed = safeParse(ev.data);
    if (parsed && typeof parsed.id === "string") removeVehicle(parsed.id);
  });
  return es;
}
