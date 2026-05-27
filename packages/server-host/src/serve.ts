import type { Server } from "bun";
import type { BizShuffleServer } from "./server.js";
import { handleHttpRequest } from "./http.js";
import { WsHub } from "./ws.js";

export interface BizShuffleServe {
  readonly hub: WsHub;
  readonly bun: Server<undefined>;
  stop(): void;
}

export function startBizShuffleServe(
  server: BizShuffleServer,
  listen: { host: string; port: number }
): BizShuffleServe {
  const hub = new WsHub(server);
  const bun = Bun.serve<undefined>({
    hostname: listen.host,
    port: listen.port,
    fetch(req, bunServer) {
      const url = new URL(req.url);
      if (url.pathname === "/ws" || url.pathname === "/ws/") {
        if (bunServer.upgrade(req)) return;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
      return handleHttpRequest(server, req);
    },
    websocket: {
      open: (ws) => hub.onOpen(ws),
      message: (ws, message) => hub.onMessage(ws, message),
      close: (ws) => hub.onClose(ws),
      pong: (ws, data) => hub.onPong(ws, data),
    },
  });
  return { hub, bun, stop: () => bun.stop(true) };
}
