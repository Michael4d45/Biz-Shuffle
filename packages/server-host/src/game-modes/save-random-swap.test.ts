import { describe, expect, it } from "bun:test";
import type { GameSwapInstance, Player } from "@bizshuffle-bun/protocol";
import { SaveModeHandler } from "./save.js";

const BANJO_ID = "banjo-kazooie--usa-";

function makePlayer(name: string, game: string, instanceId: string): Player {
  return {
    name,
    game,
    instance_id: instanceId,
    connected: true,
    has_files: true,
    bizhawk_ready: true,
  };
}

describe("SaveModeHandler handleRandomSwapForPlayer", () => {
  it("marks the displaced owner's instance pending before requesting saves", async () => {
    const pendingMarks: Array<{ instanceId: string; player: string }> = [];
    const bob = makePlayer("bob", "Banjo-Kazooie (USA).zip", BANJO_ID);
    const test = makePlayer("test", "Legend of Zelda, The - Ocarina of Time (USA).zip", "legend-of-zelda--the");
    const instances: GameSwapInstance[] = [
      { id: BANJO_ID, game: "Banjo-Kazooie (USA).zip", file_state: "ready" },
      {
        id: "legend-of-zelda--the",
        game: "Legend of Zelda, The - Ocarina of Time (USA).zip",
        file_state: "ready",
      },
    ];

    const server = {
      pendingInstanceCount: 0,
      pendingCommandCount: 0,
      snapshotState: () => ({
        players: { bob, test },
        game_instances: instances,
        prevent_same_game_swap: true,
      }),
      waitForFileCheck: async () => false,
      setInstanceFileState: (instanceId: string, state: string, pendingPlayer = "") => {
        if (state === "pending") pendingMarks.push({ instanceId, player: pendingPlayer });
      },
      setPlayerFilePending: () => undefined,
      requestPendingSaves: () => undefined,
      waitForPendingSaves: async () => false,
      updateStateAndPersist: (fn: (st: { players: Record<string, Player> }) => void) => {
        fn({ players: { bob, test } });
      },
      sendSwap: () => undefined,
    };

    const handler = new SaveModeHandler(server as never);
    handler["getRandomInstanceForPlayer"] = () => ({
      instance: instances[0]!,
      otherPlayer: bob,
    });

    await handler.handleRandomSwapForPlayer("test");

    expect(pendingMarks).toContainEqual({ instanceId: BANJO_ID, player: "bob" });
  });
});
