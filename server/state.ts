import { EventEmitter } from "node:events";
import type { Vehicle } from "./types.ts";

export interface StateOptions {
  evictAfterMs: number;
  /**
   * Coalesce per-vehicle `update` emissions across this window. Multiple
   * `upsert(v)` calls for the same id collapse to a single `update` per
   * window. Set to 0 to disable (emit synchronously).
   */
  coalesceMs?: number;
  now?: () => number;
}

export interface State extends EventEmitter {
  upsert(vehicle: Vehicle): void;
  remove(id: string): void;
  snapshot(): Vehicle[];
  evict(): void;
  dispose(): void;
}

export function createState(opts: StateOptions): State {
  const now = opts.now ?? Date.now;
  const coalesceMs = opts.coalesceMs ?? 0;
  const vehicles = new Map<string, Vehicle>();
  const emitter = new EventEmitter();

  const pendingIds = new Set<string>();
  let flushTimer: NodeJS.Timeout | null = null;

  const flush = () => {
    flushTimer = null;
    if (pendingIds.size === 0) return;
    for (const id of pendingIds) {
      const v = vehicles.get(id);
      if (v) emitter.emit("update", v);
    }
    pendingIds.clear();
  };

  const scheduleFlush = () => {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(flush, coalesceMs);
    flushTimer.unref();
  };

  const state: State = Object.assign(emitter, {
    upsert(vehicle: Vehicle) {
      vehicles.set(vehicle.id, vehicle);
      if (coalesceMs <= 0) {
        emitter.emit("update", vehicle);
        return;
      }
      pendingIds.add(vehicle.id);
      scheduleFlush();
    },
    remove(id: string) {
      if (!vehicles.has(id)) return;
      vehicles.delete(id);
      pendingIds.delete(id);
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
    dispose() {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingIds.clear();
    },
  });

  return state;
}
