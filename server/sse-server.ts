import type { Express, Request, Response } from "express";
import type { State } from "./state.ts";
import type { Vehicle } from "./types.ts";

export interface SseServerOptions {
  app: Express;
  state: State;
  path?: string;
  heartbeatMs?: number;
}

export interface SseServerHandle {
  dispose: () => void;
}

interface Client {
  res: Response;
  writeEvent: (event: string, data: unknown) => void;
}

export function startSseServer(opts: SseServerOptions): SseServerHandle {
  const path = opts.path ?? "/events";
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const clients = new Set<Client>();

  const broadcast = (event: string, data: unknown) => {
    for (const client of clients) {
      try {
        client.writeEvent(event, data);
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

  opts.app.get(path, (req: Request, res: Response) => {
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
