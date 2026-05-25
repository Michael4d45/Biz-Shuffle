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

  it("covers player and plugin endpoints", async () => {
    const base = server.url;
    await fetch(`${base}/api/add_player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: "p1" }),
    });
    const plugins = await fetch(`${base}/api/plugins`);
    expect(plugins.ok).toBe(true);
    const openRoms = await fetch(`${base}/api/open_roms_folder`, { method: "POST" });
    expect(openRoms.status).toBe(200);
    const state = await fetch(`${base}/state.json`);
    expect(state.ok).toBe(true);
  });
});
