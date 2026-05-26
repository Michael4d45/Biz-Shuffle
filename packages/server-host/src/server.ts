import { hostname } from "node:os";
import type { Server as HttpServer } from "node:http";
import {
  type Command,
  type FileState,
  type GameMode,
  type Player,
  type ServerConfig,
  type MutableServerState,
  type ServerState,
} from "@bizshuffle-bun/protocol";
import { getGameModeHandler } from "./game-modes/index.js";
import { Persistence } from "./persistence.js";
import { SwapScheduler } from "./scheduler.js";
import { ServerSession } from "./session.js";
import { WsHub } from "./ws.js";
import { createDiscoveryBroadcaster, type DiscoveryBroadcaster } from "./discovery.js";
import { createHttpApp } from "./http.js";
import { resolveAdminStaticDir } from "./static-path.js";
import { syncCatalogFromRoms } from "./rom-catalog.js";
export class BizShuffleServer {
  readonly session = new ServerSession();
  readonly persistence: Persistence;
  private readonly scheduler: SwapScheduler;
  private wsHub: WsHub | null = null;
  private httpServer: HttpServer | null = null;
  private discovery: DiscoveryBroadcaster | null = null;
  pendingInstanceCount = 0;

  readonly dataDir: string;
  readonly adminStaticDir: string;
  private listenHost = "127.0.0.1";
  private listenPort = 8080;
  constructor(config?: Partial<ServerConfig>) {
    this.dataDir = config?.dataDir ?? ".";
    if (config?.host) this.listenHost = config.host;
    if (config?.port !== undefined) this.listenPort = config.port;
    this.adminStaticDir = resolveAdminStaticDir({
      explicit: config?.staticDir,
      moduleUrl: import.meta.url,
    });

    this.persistence = new Persistence({
      dataDir: this.dataDir,
      session: this.session,
      onSaved: (updatedAt) => {
        this.wsHub?.broadcastToAdmins({
          cmd: "state_update",
          id: `${Date.now()}`,
          payload: { updated_at: updatedAt },
        });
      },
    });
    this.scheduler = new SwapScheduler(this);
  }

  get url(): string {
    return `http://${this.listenHost}:${this.listenPort}`;
  }

  snapshotState(): ServerState {
    return this.session.snapshot;
  }

  updateStateAndPersist(mutator: (st: MutableServerState) => void): void {
    this.session.update(mutator);
    this.persistence.scheduleSave();
  }

  async start(): Promise<void> {
    this.persistence.load();
    await syncCatalogFromRoms(this);
    const app = createHttpApp(this);
    await new Promise<void>((resolve, reject) => {
      const server = app.listen(this.listenPort, this.listenHost, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          this.listenPort = addr.port;
          this.listenHost = addr.address === "::" ? "127.0.0.1" : addr.address;
        }
        this.httpServer = server;
        this.wsHub = new WsHub(this, { server });
        this.updateStateAndPersist((st) => {
          st.host = this.listenHost;
          st.port = this.listenPort;
        });
        this.discovery = createDiscoveryBroadcaster(
          this.listenHost,
          this.listenPort,
          this.getServerName()
        );
        this.discovery.start();
        this.scheduler.start();
        resolve();
      });
      server.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    this.discovery?.stop();
    this.wsHub?.close();
    await this.persistence.drain();
    const http = this.httpServer;
    if (http && "closeAllConnections" in http && typeof http.closeAllConnections === "function") {
      http.closeAllConnections();
    }
    await new Promise<void>((resolve) => {
      http?.close(() => resolve());
    });
    this.httpServer = null;
    this.wsHub = null;
  }

  getServerName(): string {
    try {
      return `${hostname()} Server`;
    } catch {
      return "BizShuffle Server";
    }
  }

  get pendingCommandCount(): number {
    return this.wsHub?.pendingCommandCount ?? 0;
  }

  getGameModeHandler(mode?: GameMode) {
    const m = mode ?? this.snapshotState().mode ?? "sync";
    return getGameModeHandler(this, m);
  }

  currentPlayer(name: string): Player {
    const direct = this.session.getPlayer(name);
    if (direct.game) return direct;
    return this.getGameModeHandler().getPlayer(name);
  }

  async performSwap(): Promise<void> {
    await this.getGameModeHandler().handleSwap();
  }

  async performRandomSwapForPlayer(playerName: string): Promise<void> {
    await this.getGameModeHandler().handleRandomSwapForPlayer(playerName);
  }

  broadcastGamesUpdate(player?: Player): void {
    const { games, mainGames, instances } = this.session.snapshotGames();
    const payload = {
      game_instances: instances,
      main_games: mainGames,
      games,
    };
    const cmd: Command = {
      cmd: "games_update",
      id: `${Date.now()}`,
      payload,
    };
    if (player) {
      try {
        this.wsHub?.sendToPlayer(player, cmd);
      } catch {
        /* player not connected */
      }
    } else {
      this.wsHub?.broadcastToPlayers(cmd);
    }
  }

  sendSwap(player: Player): void {
    void (async () => {
      const payload: Record<string, string> = { game: player.game ?? "" };
      if (player.instance_id) payload.instance_id = player.instance_id;
      const cmd: Command = {
        cmd: "swap",
        payload,
        id: `swap-${Date.now()}-${player.name}`,
      };
      try {
        await this.wsHub?.sendAndWait(player, cmd);
      } catch {
        /* timeout or disconnected */
      }
    })();
  }

  sendSwapAll(): void {
    for (const p of Object.values(this.snapshotState().players)) {
      if (p.connected) this.sendSwap(p);
    }
  }

  sendMessage(
    message: string,
    duration: number,
    x: number,
    y: number,
    fontsize: number,
    fg: string,
    bg: string
  ): void {
    this.wsHub?.broadcastToPlayers({
      cmd: "message",
      id: `message-${Date.now()}`,
      payload: { message, duration, x, y, fontsize, fg, bg },
    });
  }

  broadcastToPlayers(cmd: Command): void {
    this.wsHub?.broadcastToPlayers(cmd);
  }

  sendToPlayer(player: Player, cmd: Command): void {
    this.wsHub?.sendToPlayer(player, cmd);
  }

  setInstanceFileState(instanceId: string, state: FileState, pendingPlayer = ""): void {
    this.updateStateAndPersist((st) => {
      for (let i = 0; i < (st.game_instances ?? []).length; i++) {
        const inst = st.game_instances![i]!;
        if (inst.id !== instanceId) continue;
        const prev = inst.file_state;
        if (prev === state && (inst.pending_player ?? "") === pendingPlayer) return;
        if (state === "pending") this.pendingInstanceCount++;
        if (prev === "pending" && state !== "pending") this.pendingInstanceCount--;
        inst.file_state = state;
        inst.pending_player = pendingPlayer;
        st.game_instances![i] = inst;
        break;
      }
    });
  }

  setPlayerFilePending(player: Player): void {
    if (!player.connected || !player.instance_id) return;
    this.setInstanceFileState(player.instance_id, "pending", player.name);
  }

  setPendingAllFiles(): void {
    for (const p of Object.values(this.snapshotState().players)) {
      this.setPlayerFilePending(p);
    }
  }

  requestPendingSaves(): void {
    const st = this.snapshotState();
    for (const inst of st.game_instances ?? []) {
      if (inst.file_state === "pending" && inst.pending_player) {
        const player = st.players[inst.pending_player];
        if (player?.connected) {
          this.sendToPlayer(player, {
            cmd: "request_save",
            id: `request-save-${Date.now()}-${player.name}`,
            payload: { instance_id: inst.id },
          });
        }
      }
    }
  }

  notifyScheduler(): void {
    this.scheduler.notify();
  }
}
