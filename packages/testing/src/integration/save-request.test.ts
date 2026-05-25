import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ClientRuntime, writeLuaPortFile } from "@bizshuffle-bun/client-host";
import { FakeLuaPeer, savePath, waitForFile } from "../fakes/fake-lua-peer.js";
import { startTestServer } from "../test-helpers.js";

describe("save mode request_save integration", () => {
  let hostDir: string;
  let clientDir: string;
  let server: Awaited<ReturnType<typeof startTestServer>>["server"];
  let runtime: ClientRuntime | null = null;
  let peer: FakeLuaPeer | null = null;

  beforeEach(async () => {
    clientDir = mkdtempSync(join(tmpdir(), "bizshuffle-save-cli-"));
    ({ server, dataDir: hostDir } = await startTestServer());
  });

  afterEach(async () => {
    runtime?.stop();
    peer?.stop();
    await server.stop();
    await new Promise((r) => setTimeout(r, 100));
    rmSync(hostDir, { recursive: true, force: true });
    rmSync(clientDir, { recursive: true, force: true });
  });

  async function waitForCommand(peer: FakeLuaPeer, cmd: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (peer.receivedCommands.includes(cmd)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timeout waiting for fake lua command ${cmd}`);
  }

  it("request_save triggers lua SAVE and uploads to host", async () => {
    const playerName = "save-player";
    const instanceId = "inst-save-1";

    await fetch(`${server.url}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "save" }),
    });

    await fetch(`${server.url}/api/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        main_games: [{ file: "game.zip" }],
        game_instances: [{ id: instanceId, game: "game.zip", file_state: "none" }],
      }),
    });

    peer = await FakeLuaPeer.listen({
      savesDir: clientDir,
      instanceId,
    });
    writeLuaPortFile(join(clientDir, "lua_server_port.txt"), peer.port);

    runtime = new ClientRuntime({
      dataDir: clientDir,
      serverUrl: server.url,
      playerName,
      enableDiscovery: false,
      enableBizhawkIpc: true,
      luaPort: peer.port,
    });
    await runtime.start();
    await runtime.waitForBizhawkIpc(20_000);

    server.updateStateAndPersist((st) => {
      const p = st.players[playerName] ?? {
        name: playerName,
        connected: true,
        has_files: false,
        bizhawk_ready: true,
      };
      p.game = "game.zip";
      p.instance_id = instanceId;
      p.connected = true;
      p.bizhawk_ready = true;
      st.players[playerName] = p;
    });

    server.setInstanceFileState(instanceId, "pending", playerName);
    server.requestPendingSaves();

    await waitForCommand(peer, "SAVE");
    await waitForFile(savePath(clientDir, instanceId), 15_000);
    await waitForFile(savePath(hostDir, instanceId), 20_000);

    expect(existsSync(savePath(clientDir, instanceId))).toBe(true);
    expect(existsSync(savePath(hostDir, instanceId))).toBe(true);

    const st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { game_instances: Array<{ id: string; file_state: string }> };
    };
    expect(st.state.game_instances.find((i) => i.id === instanceId)?.file_state).toBe("ready");

    const hostBytes = readFileSync(savePath(hostDir, instanceId));
    expect(hostBytes.length).toBeGreaterThan(0);
  }, 60_000);
});
