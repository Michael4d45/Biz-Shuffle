import { selectNextGame, setupSyncState, type MutablePlayer, type MutableServerState, type Player } from "@bizshuffle-bun/protocol";
import type { GameModeHandler } from "./types.js";
import type { BizShuffleServer } from "../server.js";

export class SyncModeHandler implements GameModeHandler {
  constructor(private readonly server: BizShuffleServer) {}

  private getCurrentGame(): string {
    for (const player of Object.values(this.server.snapshotState().players)) {
      if (player.game) return player.game;
    }
    return "";
  }

  private initializeSwapSeed(): number {
    let seed = this.server.snapshotState().swap_seed ?? 0;
    if (seed === 0) {
      seed = Math.floor(Date.now() / 1000);
      this.server.updateStateAndPersist((st) => {
        st.swap_seed = seed;
      });
    }
    return seed;
  }

  private isGameCompletedForPlayer(player: Player, game: string): boolean {
    return (player.completed_games ?? []).includes(game);
  }

  private selectGameForPlayer(
    player: Player,
    games: readonly string[],
    excludeList: readonly string[],
    seed: number
  ): string {
    const exclude = new Set([...excludeList, ...(player.completed_games ?? [])]);
    const picked = selectNextGame(games, exclude, seed);
    return picked?.game ?? "";
  }

  async handleSwap(): Promise<void> {
    const st = this.server.snapshotState();
    const preventSame = st.prevent_same_game_swap;
    const games = st.games ?? [];
    if (games.length === 0) return;
    const currentGame = this.getCurrentGame();
    let seed = this.initializeSwapSeed();

    const exclude = new Set<string>();
    if (preventSame && currentGame) exclude.add(currentGame);
    let picked = selectNextGame(games, exclude, seed);
    if (!picked) {
      picked = selectNextGame(games, new Set(), seed);
      if (!picked) return;
    }
    const game = picked.game;
    seed = picked.nextSeed;

    this.server.updateStateAndPersist((st) => {
      st.swap_seed = seed;
      for (const [name, player] of Object.entries(st.players)) {
        let playerGame = game;
        if (this.isGameCompletedForPlayer(player, game)) {
          const excludeList = [...(player.completed_games ?? [])];
          if (preventSame && currentGame && currentGame !== game) excludeList.push(currentGame);
          playerGame = this.selectGameForPlayer(player, games, excludeList, seed);
          if (!playerGame) continue;
        }
        player.game = playerGame;
        player.instance_id = undefined;
        st.players[name] = player;
      }
    });

    this.server.sendSwapAll();
  }

  getPlayer(player: string): Player {
    const st = this.server.snapshotState();
    for (const pp of Object.values(st.players)) {
      if (pp.game) return { name: player, game: pp.game, has_files: false, connected: false, bizhawk_ready: false };
    }
    const games = st.games ?? [];
    if (games.length > 0) {
      const seed = this.initializeSwapSeed();
      const picked = selectNextGame(games, new Set(), seed);
      if (picked) return { name: player, game: picked.game, has_files: false, connected: false, bizhawk_ready: false };
    }
    return { name: player, has_files: false, connected: false, bizhawk_ready: false };
  }

  async setupState(): Promise<void> {
    this.server.updateStateAndPersist((st) => {
      const next = setupSyncState(st);
      st.games = next.games as MutableServerState["games"];
    });
  }

  async handlePlayerSwap(player: string, game: string, _instanceId: string): Promise<void> {
    let p: MutablePlayer = { name: player, has_files: false, connected: false, bizhawk_ready: false };
    this.server.updateStateAndPersist((st) => {
      p = st.players[player] ?? p;
      p.game = game;
      p.instance_id = undefined;
      st.players[player] = p;
    });
    this.server.sendSwap(p);
  }

  async handleRandomSwapForPlayer(playerName: string): Promise<void> {
    const st = this.server.snapshotState();
    const player = st.players[playerName];
    if (!player) throw new Error(`player ${playerName} not found`);

    const preventSame = st.prevent_same_game_swap;
    const games = st.games ?? [];
    let seed = this.initializeSwapSeed();
    const exclude = new Set([...(player.completed_games ?? [])]);
    if (preventSame && player.game) exclude.add(player.game);
    const picked = selectNextGame(games, exclude, seed);
    if (!picked) return;

    this.server.updateStateAndPersist((s) => {
      s.swap_seed = picked.nextSeed;
    });
    await this.handlePlayerSwap(playerName, picked.game, "");
  }
}
