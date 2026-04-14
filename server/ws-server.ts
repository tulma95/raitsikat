import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { State } from "./state.ts";
import type { ServerMessage } from "./types.ts";
import type { Vehicle } from "./types.ts";

export interface WsServerOptions {
  server: Server;
  state: State;
  path?: string;
}

export function startWsServer(opts: WsServerOptions): WebSocketServer {
  const wss = new WebSocketServer({ server: opts.server, path: opts.path ?? "/ws" });

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const broadcast = (msg: ServerMessage) => {
    const frame = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    }
  };

  const onUpdate = (vehicle: Vehicle) => broadcast({ type: "update", vehicle });
  const onRemove = (id: string) => broadcast({ type: "remove", id });

  opts.state.on("update", onUpdate);
  opts.state.on("remove", onRemove);

  wss.on("connection", (ws) => {
    send(ws, { type: "snapshot", vehicles: opts.state.snapshot() });
  });

  wss.on("close", () => {
    opts.state.off("update", onUpdate);
    opts.state.off("remove", onRemove);
  });

  return wss;
}
