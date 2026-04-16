import type { Express, Request, Response } from "express";
import type { State } from "./state.ts";
import type { Vehicle } from "./types.ts";

export interface SseServerOptions {
  app: Express;
  state: State;
  path?: string;
  heartbeatMs?: number;
}

export function startSseServer(opts: SseServerOptions): void {
  const path = opts.path ?? "/events";
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const clients = new Set<Response>();
  let nextId = 1;

  const writeEvent = (res: Response, event: string, data: unknown) => {
    res.write(`id: ${nextId++}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const broadcast = (event: string, data: unknown) => {
    for (const res of clients) writeEvent(res, event, data);
  };

  opts.state.on("update", (vehicle: Vehicle) => broadcast("update", { vehicle }));
  opts.state.on("remove", (id: string) => broadcast("remove", { id }));

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(`: ping\n\n`);
  }, heartbeatMs);
  heartbeat.unref();

  opts.app.get(path, (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    clients.add(res);
    writeEvent(res, "snapshot", { vehicles: opts.state.snapshot() });

    req.on("close", () => clients.delete(res));
  });
}
