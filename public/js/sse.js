// SSE wiring: subscribes to /{mode}/events and routes typed events into the
// vehicles model. The server is trusted, but we still guard JSON.parse
// per event so a single malformed payload doesn't throw into the event
// listener and drop the update silently to the console.
//
// `window.__perfHooks`, if set (only when ?perf=1 is in the URL), receives
// notifications for every parsed event. Kept on a global because perf.js
// loads lazily and we don't want to import it eagerly.

import { handleSnapshot, upsertVehicle, removeVehicle } from "./vehicles.js";
import { trackConnection } from "./connection.js";

function safeParse(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function notePerf(kind, byteLen, count) {
  const hooks = window.__perfHooks;
  if (!hooks) return;
  hooks.note(kind, byteLen, count);
}

export function connect(mode) {
  const es = new EventSource(`/${mode}/events`);
  trackConnection(es);
  es.addEventListener("snapshot", (ev) => {
    /** @type {import("./types.js").SnapshotEvent | null} */
    const parsed = safeParse(ev.data);
    if (parsed && Array.isArray(parsed.vehicles)) {
      notePerf("snapshot", ev.data.length, parsed.vehicles.length);
      handleSnapshot(parsed.vehicles);
    }
  });
  es.addEventListener("update", (ev) => {
    /** @type {import("./types.js").UpdateEvent | null} */
    const parsed = safeParse(ev.data);
    if (parsed && parsed.vehicle) {
      notePerf("update", ev.data.length, 1);
      upsertVehicle(parsed.vehicle);
    }
  });
  es.addEventListener("remove", (ev) => {
    /** @type {import("./types.js").RemoveEvent | null} */
    const parsed = safeParse(ev.data);
    if (parsed && typeof parsed.id === "string") {
      notePerf("remove", ev.data.length, 1);
      removeVehicle(parsed.id);
    }
  });
  return es;
}
