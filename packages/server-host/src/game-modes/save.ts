import { categorizeInstances, setupSaveState, type GameSwapInstance, type MutablePlayer, type MutableServerState, type Player } from "@bizshuffle-bun/protocol";
import type { GameModeHandler } from "./types.js";
import type { BizShuffleServer } from "../server.js";

function validateNoDuplicateInstanceAssignments(players: Record<string, Player>): void {
  const seen = new Map<string, string>();
  for (const [name, player] of Object.entries(players)) {
    if (!player.instance_id) continue;
    const other = seen.get(player.instance_id);
    if (other) {
      throw new Error(
        `duplicate instance assignment: instance ${player.instance_id} assigned to both ${other} and ${name}`
      );
    }
    seen.set(player.instance_id, name);
  }
}

export class SaveModeHandler implements GameModeHandler {
  constructor(private readonly server: BizShuffleServer) {}

  private async waitForFileCheck(): Promise<boolean> {
    for (let i = 0; i < 3; i++) {
      const waitingFiles = this.server.pendingInstanceCount > 0;
      const waitingCmds = this.server.pendingCommandCount > 0;
      if (waitingFiles) this.server.requestPendingSaves();
      if (!waitingFiles && !waitingCmds) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return this.server.pendingInstanceCount > 0 || this.server.pendingCommandCount > 0;
  }

  private findAvailableInstanceForPlayer(
    player: Player,
    gameInstances: readonly GameSwapInstance[],
    assigned: Set<number>,
    preventSame: boolean
  ): number {
    const completedInstances = new Set(player.completed_instances ?? []);
    const completedGames = new Set(player.completed_games ?? []);
    const isAvailable = (idx: number) => {
      const inst = gameInstances[idx]!;
      return (
        !assigned.has(idx) &&
        !completedInstances.has(inst.id) &&
        !completedGames.has(inst.game)
      );
    };

    if (preventSame && player.game) {
      for (let j = 0; j < gameInstances.length; j++) {
        const inst = gameInstances[j]!;
        if (isAvailable(j) && inst.game !== player.game) return j;
      }
      if (player.instance_id) {
        for (let j = 0; j < gameInstances.length; j++) {
          const inst = gameInstances[j]!;
          if (isAvailable(j) && inst.id !== player.instance_id) return j;
        }
      }
    }
    for (let j = 0; j < gameInstances.length; j++) {
      if (isAvailable(j)) return j;
    }
    return -1;
  }

  async handleSwap(): Promise<void> {
    if (await this.waitForFileCheck()) return;

    const st = this.server.snapshotState();
    const instances = st.game_instances ?? [];
    if (instances.length === 0) return;

    const preventSame = st.prevent_same_game_swap;
    this.server.setPendingAllFiles();

    const players = Object.keys(st.players);
    const playerCurrentGames: Record<string, string> = {};
    const playerCurrentInstances: Record<string, string> = {};
    for (const [n, p] of Object.entries(st.players)) {
      playerCurrentGames[n] = p.game ?? "";
      playerCurrentInstances[n] = p.instance_id ?? "";
    }

    const shuffled = [...instances].sort(() => Math.random() - 0.5);
    const maxAssign = Math.min(shuffled.length, players.length);
    const assignedIndices = new Set<number>();

    this.server.updateStateAndPersist((state) => {
      for (const [n, p] of Object.entries(state.players)) {
        p.instance_id = undefined;
        p.game = undefined;
        state.players[n] = p;
      }

      for (let i = 0; i < maxAssign; i++) {
        const pname = players[i]!;
        const player = state.players[pname]!;
        const tempPlayer: Player = {
          ...player,
          game: playerCurrentGames[pname],
          instance_id: playerCurrentInstances[pname],
        };
        const idx = this.findAvailableInstanceForPlayer(tempPlayer, shuffled, assignedIndices, preventSame);
        if (idx >= 0) {
          const inst = shuffled[idx]!;
          player.game = inst.game;
          player.instance_id = inst.id;
          state.players[pname] = player;
          assignedIndices.add(idx);
        }
      }
      validateNoDuplicateInstanceAssignments(state.players);
    });

    this.server.sendSwapAll();
  }

  getPlayer(player: string): Player {
    const state = this.server.snapshotState();
    const assigned = new Set(
      Object.values(state.players)
        .map((p) => p.instance_id)
        .filter(Boolean) as string[]
    );
    for (const inst of state.game_instances ?? []) {
      if (assigned.has(inst.id)) continue;
      return {
        name: player,
        game: inst.game,
        instance_id: inst.id,
        has_files: false,
        connected: false,
        bizhawk_ready: false,
      };
    }
    return { name: player, has_files: false, connected: false, bizhawk_ready: false };
  }

  async setupState(): Promise<void> {
    this.server.updateStateAndPersist((st) => {
      const next = setupSaveState(st);
      st.game_instances = next.game_instances as MutableServerState["game_instances"];
    });
  }

  async handlePlayerSwap(player: string, _game: string, instanceId: string): Promise<void> {
    if (!instanceId) throw new Error("instance ID is required");

    let foundInst: GameSwapInstance | undefined;
    let foundPlayer: Player | undefined;
    let p: MutablePlayer = { name: player, has_files: false, connected: false, bizhawk_ready: false };

    this.server.updateStateAndPersist((st) => {
      foundInst = (st.game_instances ?? []).find((i) => i.id === instanceId);
      for (const [playerName, swapping] of Object.entries(st.players)) {
        if (swapping.instance_id === instanceId && playerName !== player) {
          swapping.game = undefined;
          swapping.instance_id = undefined;
          st.players[playerName] = swapping;
          if (swapping.connected) foundPlayer = swapping;
          break;
        }
      }
      if (foundInst) {
        p = st.players[player] ?? p;
        p.game = foundInst.game;
        p.instance_id = foundInst.id;
        st.players[player] = p;
      }
    });

    if (!foundInst) throw new Error("instance not found");
    if (foundPlayer) {
      this.server.setInstanceFileState(foundInst.id, "pending", foundPlayer.name);
      this.server.sendSwap(foundPlayer);
    } else {
      this.server.setInstanceFileState(foundInst.id, "none");
    }
    this.server.sendSwap(p);
  }

  private getRandomInstanceForPlayer(player: Player): {
    instance: GameSwapInstance;
    otherPlayer?: Player;
  } | null {
    const st = this.server.snapshotState();
    const preventSame = st.prevent_same_game_swap;
    const buckets = categorizeInstances(
      st.game_instances ?? [],
      st.players,
      player.name,
      player.game ?? "",
      player.instance_id ?? "",
      preventSame
    );
    const order = preventSame
      ? [0, 1, 4, 2, 3, 5]
      : [0, 2, 4, 1, 3, 5];
    let selectedId = "";
    for (const idx of order) {
      const bucket = buckets[idx]!;
      if (bucket.length > 0) {
        selectedId = bucket[Math.floor(Math.random() * bucket.length)]!.id;
        break;
      }
    }
    if (!selectedId) return null;
    const instance = (st.game_instances ?? []).find((i) => i.id === selectedId);
    if (!instance) return null;
    const otherPlayer = Object.values(st.players).find((p) => p.instance_id === selectedId);
    return { instance, otherPlayer };
  }

  async handleRandomSwapForPlayer(playerName: string): Promise<void> {
    if (await this.waitForFileCheck()) return;

    const swapped = new Set<string>();
    for (const name of Object.keys(this.server.snapshotState().players)) {
      swapped.add(name);
    }

    let current = playerName;
    while (true) {
      const player = structuredClone(this.server.snapshotState().players[current]!) as MutablePlayer;
      if (!player) throw new Error(`player ${current} not found`);

      const pick = this.getRandomInstanceForPlayer(player);
      if (!pick) break;

      this.server.setPlayerFilePending(player);
      player.instance_id = pick.instance.id;
      player.game = pick.instance.game;

      this.server.updateStateAndPersist((st) => {
        if (pick.otherPlayer) {
          for (const [n, pl] of Object.entries(st.players)) {
            if (pl.instance_id === pick.instance.id && n !== player.name) {
              pl.game = undefined;
              pl.instance_id = undefined;
              st.players[n] = pl;
            }
          }
        }
        st.players[player.name] = player;
        validateNoDuplicateInstanceAssignments(st.players);
      });

      this.server.sendSwap(player);
      swapped.delete(player.name);
      if (!pick.otherPlayer || swapped.has(pick.otherPlayer.name)) break;
      current = pick.otherPlayer.name;
    }
  }
}
