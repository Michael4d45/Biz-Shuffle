import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BizShuffleServer } from "@bizshuffle-bun/server-host";
import { startTestServer, stopTestServer } from "../test-helpers.js";

describe("save mode random swap", () => {
  let dataDir: string;
  let server: BizShuffleServer;

  beforeEach(async () => {
    ({ server, dataDir } = await startTestServer());
    const base = server.url;
    await fetch(`${base}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "save" }),
    });
    await fetch(`${base}/api/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        main_games: [{ file: "test.zip" }],
        game_instances: [{ id: "test-1", game: "test.zip", file_state: "none" }],
      }),
    });
    await fetch(`${base}/api/add_player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "solo" }),
    });
  });

  afterEach(async () => {
    await stopTestServer(server, dataDir);
  });

  it("returns promptly with one player and one instance (no event-loop hang)", async () => {
    const base = server.url;
    await fetch(`${base}/api/swap_player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "solo", instance_id: "test-1" }),
    });

    const res = await Promise.race([
      fetch(`${base}/api/random_swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player: "solo" }),
      }),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error("random_swap hung")), 2000)
      ),
    ]);
    expect(res.status).toBe(200);

    const stateRes = await fetch(`${base}/state.json`);
    const body = (await stateRes.json()) as { state: { players: Record<string, { game?: string }> } };
    expect(body.state.players.solo?.game).toBe("test.zip");
  });
});
