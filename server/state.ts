import { EventEmitter } from "node:events";
import type { Vehicle } from "./types.ts";

export interface StateOptions {
  evictAfterMs: number;
  now?: () => number;
}

export interface State extends EventEmitter {
  upsert(vehicle: Vehicle): void;
  remove(id: string): void;
  snapshot(): Vehicle[];
  evict(): void;
}

export function createState(opts: StateOptions): State {
  const now = opts.now ?? Date.now;
  const vehicles = new Map<string, Vehicle>();
  const emitter = new EventEmitter();

  const state: State = Object.assign(emitter, {
    upsert(vehicle: Vehicle) {
      vehicles.set(vehicle.id, vehicle);
      emitter.emit("update", vehicle);
    },
    remove(id: string) {
      if (!vehicles.has(id)) return;
      vehicles.delete(id);
      emitter.emit("remove", id);
    },
    snapshot(): Vehicle[] {
      return Array.from(vehicles.values());
    },
    evict() {
      const cutoff = now() - opts.evictAfterMs;
      for (const [id, v] of vehicles) {
        if (v.updatedAt < cutoff) state.remove(id);
      }
    },
  });

  return state;
}
