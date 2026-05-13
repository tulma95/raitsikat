// SSE wiring: subscribes to /events and routes typed events into the
// vehicles model. Returns the EventSource so the caller can attach
// connection-state UI.

import { handleSnapshot, upsertVehicle, removeVehicle } from "./vehicles.js";
import { trackConnection } from "./connection.js";

export function connect() {
  const es = new EventSource("/events");
  trackConnection(es);
  es.addEventListener("snapshot", (ev) => {
    /** @type {import("./types.js").SnapshotEvent} */
    const { vehicles } = JSON.parse(ev.data);
    handleSnapshot(vehicles);
  });
  es.addEventListener("update", (ev) => {
    /** @type {import("./types.js").UpdateEvent} */
    const { vehicle } = JSON.parse(ev.data);
    upsertVehicle(vehicle);
  });
  es.addEventListener("remove", (ev) => {
    /** @type {import("./types.js").RemoveEvent} */
    const { id } = JSON.parse(ev.data);
    removeVehicle(id);
  });
  return es;
}
