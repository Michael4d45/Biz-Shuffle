import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BizShuffleServer } from "@bizshuffle-bun/server-host";
import { startTestServer, stopTestServer } from "../test-helpers.js";

describe("admin API parity", () => {
  let dataDir: string;
  let server: BizShuffleServer;

  beforeEach(async () => {
    ({ server, dataDir } = await startTestServer());
    await fetch(`${server.url}/api/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ games: ["test.zip"], main_games: [{ file: "test.zip" }] }),
    });
    await fetch(`${server.url}/api/add_player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "p1" }),
    });
  });

  afterEach(async () => {
    await stopTestServer(server, dataDir);
  });

  it("covers session and control endpoints", async () => {
    const base = server.url;
    const paths = [
      "/api/start",
      "/api/pause",
      "/api/toggle_swaps",
      "/api/toggle_countdown",
      "/api/toggle_prevent_same_game",
      "/api/mode/setup",
    ];
    for (const path of paths) {
      const res = await fetch(`${base}${path}`, { method: "POST" });
      expect(res.status, path).toBe(200);
    }
    const mode = await fetch(`${base}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "sync" }),
    });
    expect(mode.status).toBe(200);
    const res = await fetch(`${base}/api/do_swap`, { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("covers player messaging and swap endpoints", async () => {
    const base = server.url;
    const swapPlayer = await fetch(`${base}/api/swap_player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "p1", game: "test.zip" }),
    });
    expect(swapPlayer.status).toBe(200);

    const messageAll = await fetch(`${base}/api/message_all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi", duration: 3 }),
    });
    expect(messageAll.status).toBe(200);

    const completed = await fetch(`${base}/api/players/p1/completed_games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: "test.zip" }),
    });
    expect(completed.status).toBe(200);

    const removeCompleted = await fetch(
      `${base}/api/players/p1/completed_games?game=${encodeURIComponent("test.zip")}`,
      { method: "DELETE" }
    );
    expect(removeCompleted.status).toBe(200);
  });

  it("covers config and files endpoints", async () => {
    const base = server.url;
    const checkConfig = await fetch(`${base}/api/check_player_config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "p1" }),
    });
    expect(checkConfig.status).toBe(400);

    const updateConfig = await fetch(`${base}/api/update_player_config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "p1", config: "{}" }),
    });
    expect([200, 500].includes(updateConfig.status)).toBe(true);

    const files = await fetch(`${base}/files/list.json`);
    expect(files.ok).toBe(true);

    const plugins = await fetch(`${base}/api/plugins`);
    expect(plugins.ok).toBe(true);
    const openRoms = await fetch(`${base}/api/open_roms_folder`, { method: "POST" });
    expect(openRoms.status).toBe(200);
  });
});
