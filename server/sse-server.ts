import { Router, type Request, type Response } from "express";
import type { State } from "./state.ts";
import type { Vehicle } from "./types.ts";

export interface SseServerOptions {
  state: State;
  path?: string;
  heartbeatMs?: number;
}

export interface SseServerHandle {
  router: Router;
  dispose: () => void;
}

interface Client {
  res: Response;
  writeEvent: (event: string, data: unknown) => void;
}

// We broadcast the full vehicle firehose to every client (the client culls by
// viewport, the server doesn't). A consumer that can't keep up would otherwise
// accumulate unbounded buffered writes in Node's heap, since res.write() never
// rejects — it just buffers. Drop any client whose socket buffer crosses this
// cap; EventSource will reconnect and get a fresh snapshot.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export function startSseServer(opts: SseServerOptions): SseServerHandle {
  const path = opts.path ?? "/events";
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const clients = new Set<Client>();

  const drop = (client: Client) => {
    clients.delete(client);
    try {
      client.res.end();
    } catch {
      // already torn down
    }
  };

  const broadcast = (event: string, data: unknown) => {
    for (const client of clients) {
      try {
        client.writeEvent(event, data);
        if (client.res.writableLength > MAX_BUFFERED_BYTES) drop(client);
      } catch {
        clients.delete(client);
      }
    }
  };

  const onUpdate = (vehicle: Vehicle) => broadcast("update", { vehicle });
  const onRemove = (id: string) => broadcast("remove", { id });
  opts.state.on("update", onUpdate);
  opts.state.on("remove", onRemove);

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      try {
        client.res.write(`: ping\n\n`);
      } catch {
        clients.delete(client);
      }
    }
  }, heartbeatMs);
  heartbeat.unref();

  const router = Router();
  router.get(path, (req: Request, res: Response) => {
    let nextId = 1;

    const writeEvent = (event: string, data: unknown) => {
      res.write(`id: ${nextId++}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const client: Client = { res, writeEvent };

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    clients.add(client);
    try {
      writeEvent("snapshot", { vehicles: opts.state.snapshot() });
    } catch {
      clients.delete(client);
    }

    req.on("close", () => clients.delete(client));
  });

  return {
    router,
    dispose: () => {
      opts.state.off("update", onUpdate);
      opts.state.off("remove", onRemove);
      clearInterval(heartbeat);
      for (const client of clients) {
        try {
          client.res.end();
        } catch {
          // ignore
        }
      }
      clients.clear();
    },
  };
}
