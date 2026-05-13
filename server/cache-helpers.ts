// Small composable building blocks shared by route-cache and stop-cache.
//
// startRefillScheduler — drives a periodic warm-up function. Skips ticks while
// one is already running, and skips ticks that fall inside the success gate.
// Self-healing: a tick that returns false (or throws) doesn't advance the gate,
// so the next interval will retry.
//
// createCoalescer — deduplicates concurrent lazy lookups for the same key, so
// N parallel cache-miss requests trigger one upstream call.

export interface RefillSchedulerOptions {
  intervalMs: number;
  gateMs: number;
  label: string;
  refill: () => Promise<boolean>; // resolves true on full success
  now?: () => number;
}

export interface RefillSchedulerHandle {
  stop: () => void;
}

export function startRefillScheduler(opts: RefillSchedulerOptions): RefillSchedulerHandle {
  const now = opts.now ?? Date.now;
  let lastSuccessAt = 0;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    if (now() - lastSuccessAt < opts.gateMs) return;
    inFlight = true;
    try {
      const ok = await opts.refill();
      if (ok) lastSuccessAt = now();
    } catch (err) {
      console.error(`[${opts.label}] refill threw:`, (err as Error).message);
    } finally {
      inFlight = false;
    }
  };

  tick();
  const ticker = setInterval(() => {
    tick();
  }, opts.intervalMs);
  ticker.unref();

  return {
    stop: () => clearInterval(ticker),
  };
}

export interface Coalescer<K, V> {
  run(key: K, factory: () => Promise<V>): Promise<V>;
}

export function createCoalescer<K, V>(): Coalescer<K, V> {
  const inFlight = new Map<K, Promise<V>>();
  return {
    run(key, factory) {
      let pending = inFlight.get(key);
      if (!pending) {
        pending = (async () => {
          try {
            return await factory();
          } finally {
            inFlight.delete(key);
          }
        })();
        inFlight.set(key, pending);
      }
      return pending;
    },
  };
}
