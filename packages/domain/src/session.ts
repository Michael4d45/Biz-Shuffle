import {
  defaultServerState,
  type GameSwapInstance,
  type MutableServerState,
  type Player,
  type ServerState,
} from "@bizshuffle-bun/protocol";

export function freshServerState(): ServerState {
  return {
    ...defaultServerState(),
    swap_enabled: true,
    max_interval_secs: 300,
    min_interval_secs: 5,
    game_instances: [],
    games: [],
    main_games: [],
    plugins: {},
  };
}

export class ServerSession {
  private state: MutableServerState;

  constructor(initial?: ServerState) {
    this.state = structuredClone(initial ?? freshServerState()) as MutableServerState;
  }

  get snapshot(): ServerState {
    return structuredClone(this.state);
  }

  get raw(): MutableServerState {
    return this.state;
  }

  update(mutator: (st: MutableServerState) => void): string {
    mutator(this.state);
    const updatedAt = new Date().toISOString();
    this.state.updated_at = updatedAt;
    return updatedAt;
  }

  snapshotPlayers(): Record<string, Player> {
    return structuredClone(this.state.players);
  }

  snapshotGames(): {
    games: string[];
    mainGames: ServerState["main_games"];
    instances: GameSwapInstance[];
  } {
    return {
      games: [...(this.state.games ?? [])],
      mainGames: structuredClone(this.state.main_games ?? []),
      instances: structuredClone(this.state.game_instances ?? []),
    };
  }

  getPlayer(name: string): Player {
    return this.state.players[name] ?? { name, has_files: false, connected: false, bizhawk_ready: false };
  }

  setState(next: ServerState): void {
    this.state = structuredClone(next) as MutableServerState;
  }
}
