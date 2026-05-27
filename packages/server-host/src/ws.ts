import { SWAP_WAIT_MS, type Command, type Player } from "@bizshuffle-bun/protocol";
import type { ServerWebSocket } from "bun";
import type { BizShuffleServer } from "./server.js";

export const ERR_TIMEOUT = new Error("timeout waiting for result");

interface WsClient {
  ws: ServerWebSocket<undefined>;
  sendQueue: Command[];
  closed: boolean;
}

export class WsHub {
  private readonly clients = new Map<ServerWebSocket<undefined>, WsClient>();
  private readonly playerClients = new Map<string, WsClient>();
  private readonly adminClients = new Map<string, WsClient>();
  private readonly pending = new Map<
    string,
    { resolve: (v: string) => void; reject: (e: Error) => void }
  >();
  private readonly flushTimers = new Map<
    ServerWebSocket<undefined>,
    ReturnType<typeof setInterval>
  >();
  private readonly pingTimers = new Map<
    ServerWebSocket<undefined>,
    ReturnType<typeof setInterval>
  >();

  constructor(private readonly server: BizShuffleServer) {}

  close(): void {
    for (const [, client] of this.clients) {
      client.ws.close();
    }
    for (const timer of this.flushTimers.values()) clearInterval(timer);
    for (const timer of this.pingTimers.values()) clearInterval(timer);
    this.flushTimers.clear();
    this.pingTimers.clear();
    this.clients.clear();
    this.playerClients.clear();
    this.adminClients.clear();
  }

  get pendingCommandCount(): number {
    return this.pending.size;
  }

  onOpen(ws: ServerWebSocket<undefined>): void {
    const client: WsClient = { ws, sendQueue: [], closed: false };
    this.clients.set(ws, client);

    const pingInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.ping(`${Date.now() * 1_000_000}`);
    }, 30_000);
    this.pingTimers.set(ws, pingInterval);

    const flush = () => {
      while (client.sendQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
        const cmd = client.sendQueue.shift()!;
        if (cmd.cmd === "ping") {
          const payload =
            typeof cmd.payload === "string" && cmd.payload
              ? cmd.payload
              : `${Date.now() * 1_000_000}`;
          ws.ping(payload);
        } else {
          ws.send(JSON.stringify(cmd));
        }
      }
    };
    this.flushTimers.set(ws, setInterval(flush, 10));
  }

  onPong(ws: ServerWebSocket<undefined>, data: string | Buffer): void {
    const client = this.clients.get(ws);
    if (!client) return;
    const payload = data.toString();
    if (!payload) return;
    const ts = Number.parseInt(payload, 10);
    if (Number.isNaN(ts)) return;
    const sentMs = Math.floor(ts / 1_000_000);
    const rtt = Date.now() - sentMs;
    const name = this.findPlayerName(client);
    if (name) {
      this.server.updateStateAndPersist((st) => {
        const pl = st.players[name];
        if (pl) {
          pl.ping_ms = rtt;
          st.players[name] = pl;
        }
      });
    }
  }

  onMessage(ws: ServerWebSocket<undefined>, raw: string | Buffer): void {
    const client = this.clients.get(ws);
    if (!client) return;
    let cmd: Command;
    try {
      cmd = JSON.parse(raw.toString()) as Command;
    } catch {
      return;
    }
    void this.handleMessage(client, cmd);
  }

  onClose(ws: ServerWebSocket<undefined>): void {
    const flushTimer = this.flushTimers.get(ws);
    if (flushTimer) clearInterval(flushTimer);
    this.flushTimers.delete(ws);
    const pingTimer = this.pingTimers.get(ws);
    if (pingTimer) clearInterval(pingTimer);
    this.pingTimers.delete(ws);

    const client = this.clients.get(ws);
    if (!client) return;
    client.closed = true;
    const playerName = this.findPlayerName(client);
    if (playerName) {
      this.playerClients.delete(playerName);
      this.server.updateStateAndPersist((st) => {
        const pl = st.players[playerName];
        if (pl) {
          pl.connected = false;
          st.players[playerName] = pl;
        }
      });
    } else {
      const adminName = this.findAdminName(client);
      if (adminName) this.adminClients.delete(adminName);
    }
    this.clients.delete(ws);
  }

  private findPlayerName(client: WsClient): string {
    for (const [name, c] of this.playerClients) {
      if (c === client) return name;
    }
    return "";
  }

  private findAdminName(client: WsClient): string {
    for (const [name, c] of this.adminClients) {
      if (c === client) return name;
    }
    return "";
  }

  private async handleMessage(client: WsClient, cmd: Command): Promise<void> {
    switch (cmd.cmd) {
      case "ack":
      case "nack": {
        const pending = this.pending.get(cmd.id);
        if (pending) {
          const reason = cmd.cmd === "nack" ? `nack|${JSON.stringify(cmd.payload ?? {})}` : "ack";
          pending.resolve(reason);
          this.pending.delete(cmd.id);
        }
        return;
      }
      case "games_update_ack": {
        const name = this.findPlayerName(client);
        const pl = cmd.payload as { has_files?: boolean } | undefined;
        if (name && pl && typeof pl.has_files === "boolean") {
          this.server.updateStateAndPersist((st) => {
            const p = st.players[name];
            if (p) {
              p.has_files = pl.has_files!;
              st.players[name] = p;
            }
          });
        }
        return;
      }
      case "hello": {
        const pl = cmd.payload as { name?: string; bizhawk_ready?: boolean } | undefined;
        const name = pl?.name ?? "";
        if (!name) return;
        this.playerClients.set(name, client);
        this.server.updateStateAndPersist((st) => {
          const player = st.players[name] ?? {
            name,
            has_files: false,
            connected: false,
            bizhawk_ready: false,
          };
          player.connected = true;
          if (typeof pl?.bizhawk_ready === "boolean") player.bizhawk_ready = pl.bizhawk_ready;
          st.players[name] = player;
        });
        const player = this.server.assignPlayerOnConnect(name);
        this.server.broadcastGamesUpdate(player);
        if (player.game) this.server.sendSwap(player);
        void this.sendPing(player);
        return;
      }
      case "status_update": {
        const name = this.findPlayerName(client);
        const pl = cmd.payload as { bizhawk_ready?: boolean } | undefined;
        if (name && typeof pl?.bizhawk_ready === "boolean") {
          let becameReady = false;
          this.server.updateStateAndPersist((st) => {
            const p = st.players[name];
            if (p) {
              becameReady = pl.bizhawk_ready! && !p.bizhawk_ready;
              p.bizhawk_ready = pl.bizhawk_ready!;
              st.players[name] = p;
            }
          });
          if (becameReady) {
            const player = this.server.currentPlayer(name);
            if (player.game) this.server.sendSwap(player);
          }
        }
        return;
      }
      case "hello_admin": {
        const pl = cmd.payload as { name?: string } | undefined;
        const name = pl?.name ?? "";
        if (!name) return;
        this.adminClients.set(name, client);
        this.enqueue(client, {
          cmd: "ping",
          id: `ping-${Date.now()}`,
          payload: `${Date.now() * 1_000_000}`,
        });
        return;
      }
      case "lua_command": {
        const lua = cmd.payload as { Kind?: string; kind?: string } | undefined;
        const kind = lua?.Kind ?? lua?.kind;
        if (kind === "swap") {
          await this.server.performSwap();
        } else if (kind === "swap_me") {
          const name = this.findPlayerName(client);
          if (name) await this.server.performRandomSwapForPlayer(name);
        }
        return;
      }
      case "config_response": {
        const name = this.findPlayerName(client);
        const pl = cmd.payload as { config_values?: Record<string, unknown> } | undefined;
        if (name && pl?.config_values) {
          this.server.updateStateAndPersist((st) => {
            const p = st.players[name];
            if (p) {
              p.config_values = pl.config_values;
              st.players[name] = p;
            }
          });
        }
        return;
      }
      default:
        return;
    }
  }

  enqueue(client: WsClient, cmd: Command): void {
    if (client.closed) return;
    client.sendQueue.push(cmd);
    if (client.ws.readyState === WebSocket.OPEN) {
      if (cmd.cmd === "ping") {
        const payload =
          typeof cmd.payload === "string" && cmd.payload
            ? cmd.payload
            : `${Date.now() * 1_000_000}`;
        client.ws.ping(payload);
      } else {
        client.ws.send(JSON.stringify(cmd));
      }
    }
  }

  broadcastToPlayers(cmd: Command): void {
    for (const client of this.playerClients.values()) {
      this.enqueue(client, cmd);
    }
    this.broadcastToAdmins(cmd);
  }

  broadcastToAdmins(cmd: Command): void {
    for (const client of this.adminClients.values()) {
      this.enqueue(client, cmd);
    }
  }

  sendToPlayer(player: Player, cmd: Command): void {
    const client = this.playerClients.get(player.name);
    if (!client) throw new Error(`no connection for player ${player.name}`);
    this.broadcastToAdmins({
      cmd: cmd.cmd,
      id: cmd.id,
      payload: { player: player.name, original_payload: cmd.payload },
    });
    this.enqueue(client, cmd);
  }

  async sendAndWait(player: Player, cmd: Command, timeoutMs = SWAP_WAIT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmd.id);
        reject(ERR_TIMEOUT);
      }, timeoutMs);
      this.pending.set(cmd.id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.sendToPlayer(player, cmd);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(cmd.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  sendPing(player: Player): void {
    const client = this.playerClients.get(player.name);
    if (!client) throw new Error(`no connection for player ${player.name}`);
    this.enqueue(client, {
      cmd: "ping",
      id: `ping-${Date.now()}`,
      payload: `${Date.now() * 1_000_000}`,
    });
  }
}
