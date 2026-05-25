import type { GameSwapInstance, Player, ServerState } from "./schemas.js";

export function selectNextGame(
  games: readonly string[],
  exclude: Set<string>,
  seed: number
): { game: string; nextSeed: number } | null {
  const filtered = games.filter((g) => !exclude.has(g));
  if (filtered.length === 0) return null;
  const idx = Math.abs(seed) % filtered.length;
  return { game: filtered[idx]!, nextSeed: seed + 1 };
}

export function generateInstanceId(game: string, existing: Set<string>): string {
  let base = game
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .slice(0, 20);
  if (!base) base = "instance";
  let id = base;
  let n = 1;
  while (existing.has(id)) {
    id = `${base}-${n}`;
    n++;
  }
  return id;
}

export function categorizeInstances(
  instances: readonly GameSwapInstance[],
  players: Record<string, Player>,
  _playerName: string,
  currentGame: string,
  currentInstance: string,
  preventSame: boolean
): GameSwapInstance[][] {
  const buckets: GameSwapInstance[][] = [[], [], [], [], [], []];
  for (const inst of instances) {
    const owner = Object.values(players).find((p) => p.instance_id === inst.id);
    const unassigned = !owner;
    const sameGame = inst.game === currentGame;
    const sameInst = inst.id === currentInstance;
    let bucket = 5;
    if (preventSame) {
      if (unassigned && !sameGame) bucket = 0;
      else if (unassigned && sameGame) bucket = 1;
      else if (!unassigned && !sameGame) bucket = 2;
      else if (!unassigned && sameGame && !sameInst) bucket = 3;
      else bucket = 4;
    } else if (unassigned) bucket = 0;
    else bucket = 2;
    buckets[bucket]!.push(inst);
  }
  return buckets;
}

export function setupSyncState(state: ServerState): ServerState {
  const games = new Set(state.games ?? []);
  for (const mg of state.main_games ?? []) {
    games.add(mg.file);
  }
  return { ...state, games: [...games] };
}

export function setupSaveState(state: ServerState): ServerState {
  const instances = [...(state.game_instances ?? [])];
  const existingGames = new Set(instances.map((i) => i.game));
  const ids = new Set(instances.map((i) => i.id));
  for (const mg of state.main_games ?? []) {
    if (!existingGames.has(mg.file)) {
      const id = generateInstanceId(mg.file, ids);
      ids.add(id);
      instances.push({ id, game: mg.file, file_state: "none" });
    }
  }
  return { ...state, game_instances: instances };
}
