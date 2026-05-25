import type { GameMode } from "@bizshuffle-bun/protocol";
import type { BizShuffleServer } from "../server.js";
import { SaveModeHandler } from "./save.js";
import { SyncModeHandler } from "./sync.js";
import type { GameModeHandler } from "./types.js";

export function getGameModeHandler(server: BizShuffleServer, mode: GameMode): GameModeHandler {
  switch (mode) {
    case "sync":
      return new SyncModeHandler(server);
    case "save":
      return new SaveModeHandler(server);
    default:
      throw new Error(`unexpected game mode: ${mode}`);
  }
}

export type { GameModeHandler } from "./types.js";
