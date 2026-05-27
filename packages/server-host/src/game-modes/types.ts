import type { Player } from "@bizshuffle-bun/protocol";

export interface GameModeHandler {
  handleSwap(): Promise<void>;
  getPlayer(player: string): Player;
  setupState(): Promise<void>;
  handlePlayerSwap(player: string, game: string, instanceId: string): Promise<void>;
  handleRandomSwapForPlayer(playerName: string): Promise<void>;
}
