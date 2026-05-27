import { hostname } from "node:os";
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
import { startBizShuffleServe, type BizShuffleServe } from "./serve.js";
import { resolveAdminStaticDir } from "./static-path.js";
import { syncCatalogFromRoms } from "./rom-catalog.js";
import { discoveryAdvertiseHost } from "./share-urls.js";

export class BizShuffleServer {
  readonly session = new ServerSession();
  readonly persistence: Persistence;
  private readonly scheduler: SwapScheduler;
  private wsHub: WsHub | null = null;
  private serve: BizShuffleServe | null = null;
  private discovery: DiscoveryBroadcaster | null = null;
  pendingInstanceCount = 0;
  /** Last swap target the player client acknowledged (per player name). */
  private readonly appliedSwapTarget = new Map<string, string>();
  private readonly swapInFlight = new Set<string>();

  readonly dataDir: string;
  readonly adminStaticDir: string;
  private bindHost = "127.0.0.1";
  private listenHost = "127.0.0.1";
  private listenPort = 8080;
  constructor(config?: Partial<ServerConfig>) {
    this.dataDir = config?.dataDir ?? ".";
    if (config?.host) {
      this.bindHost = config.host;
      this.listenHost = config.host;
    }
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

  /** Actual socket bind address (e.g. `0.0.0.0`), not the local admin URL host. */
  getBindHost(): string {
    return this.bindHost;
  }

  getListeningPort(): number {
    return this.listenPort;
  }

  snapshotState(): ServerState {
    return this.session.snapshot;
  }

  updateStateAndPersist(mutator: (st: MutableServerState) => void): void {
    this.session.update(mutator);
    this.persistence.scheduleSave();
  }

  async start(): Promise<void> {
    await this.persistence.load();
    await syncCatalogFromRoms(this);
    const bind = this.bindHost;
    const serve = startBizShuffleServe(this, {
      host: bind,
      port: this.listenPort,
    });
    this.serve = serve;
    this.wsHub = serve.hub;
    this.listenPort = serve.bun.port ?? this.listenPort;
    const hostname = serve.bun.hostname ?? bind;
    this.listenHost =
      hostname === "::" || hostname === "0.0.0.0" || !hostname ? "127.0.0.1" : hostname;
    this.updateStateAndPersist((st) => {
      st.host = this.listenHost;
      st.port = this.listenPort;
    });
    this.discovery = createDiscoveryBroadcaster(
      discoveryAdvertiseHost(bind),
      this.listenPort,
      this.getServerName()
    );
    this.discovery.start();
    this.scheduler.start();
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    this.discovery?.stop();
    this.wsHub?.close();
    await this.persistence.drain();
    this.serve?.stop();
    this.serve = null;
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

  /** Persist game-mode assignment for a newly connected player, if unassigned. */
  assignPlayerOnConnect(name: string): Player {
    const assigned = this.currentPlayer(name);
    this.updateStateAndPersist((st) => {
      const p = st.players[name];
      if (!p) return;
      let changed = false;
      if (assigned.game && !p.game) {
        p.game = assigned.game;
        changed = true;
      }
      if (assigned.instance_id && !p.instance_id) {
        p.instance_id = assigned.instance_id;
        changed = true;
      }
      if (changed) st.players[name] = p;
    });
    return this.currentPlayer(name);
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

  swapTargetKey(player: Player): string {
    return `${player.game ?? ""}\0${player.instance_id ?? ""}`;
  }

  shouldSendSwap(player: Player, force?: boolean): boolean {
    if (force) return true;
    return this.appliedSwapTarget.get(player.name) !== this.swapTargetKey(player);
  }

  recordSwapApplied(playerName: string, player: Player): void {
    this.appliedSwapTarget.set(playerName, this.swapTargetKey(player));
  }

  clearAppliedSwap(playerName: string): void {
    this.appliedSwapTarget.delete(playerName);
  }

  sendSwap(player: Player, options?: { skipSave?: boolean; force?: boolean }): void {
    if (!this.shouldSendSwap(player, options?.force)) return;
    if (this.swapInFlight.has(player.name)) return;
    this.swapInFlight.add(player.name);
    void (async () => {
      const payload: Record<string, string | boolean> = { game: player.game ?? "" };
      if (player.instance_id) payload.instance_id = player.instance_id;
      if (options?.skipSave) payload.skip_save = true;
      const cmd: Command = {
        cmd: "swap",
        payload,
        id: `swap-${Date.now()}-${player.name}-${Math.random().toString(36).slice(2, 8)}`,
      };
      try {
        await this.wsHub?.sendAndWait(player, cmd, {
          onAck: () => this.recordSwapApplied(player.name, player),
        });
      } catch {
        /* timeout or disconnected */
      } finally {
        this.swapInFlight.delete(player.name);
      }
    })();
  }

  sendSwapAll(options?: { skipSave?: boolean }): void {
    for (const p of Object.values(this.snapshotState().players)) {
      if (p.connected) this.sendSwap(p, options);
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
    for (const name of Object.keys(this.snapshotState().players)) {
      this.setPlayerFilePending(this.currentPlayer(name));
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
