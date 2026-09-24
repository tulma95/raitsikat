import type { Departure } from "./types.ts";

// One session per open popup. Closing it invalidates pending responses and
// cancels requests as well as both timers; a reopened popup starts fresh.
export function startDepartureRefresh(options: {
  load: (signal: AbortSignal) => Promise<Departure[]>;
  render: (departures: Departure[]) => void;
  error: () => void;
}): () => void {
  let closed = false;
  let controller: AbortController | null = null;
  let departures: Departure[] | null = null;

  const refresh = async () => {
    if (closed || controller) return;
    const request = new AbortController();
    controller = request;
    try {
      const next = await options.load(request.signal);
      if (closed) return;
      departures = next;
      options.render(next);
    } catch {
      if (closed) return;
      departures = null;
      options.error();
    } finally {
      controller = null;
    }
  };

  const refreshTimer = setInterval(() => void refresh(), 30_000);
  const countdownTimer = setInterval(() => {
    if (departures !== null) options.render(departures);
  }, 1_000);
  void refresh();

  return () => {
    closed = true;
    clearInterval(refreshTimer);
    clearInterval(countdownTimer);
    controller?.abort();
  };
}
