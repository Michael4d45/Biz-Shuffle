import type { Player, MutableServerState } from "@bizshuffle-bun/protocol";
import type { BizShuffleServer } from "../server.js";

export interface GameModeHandler {
  handleSwap(): Promise<void>;
  getPlayer(player: string): Player;
  setupState(): Promise<void>;
  handlePlayerSwap(player: string, game: string, instanceId: string): Promise<void>;
  handleRandomSwapForPlayer(playerName: string): Promise<void>;
}

export type StateMutator = (st: MutableServerState) => void;

export type ServerRef = BizShuffleServer;
