import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ClientRuntime, writeLuaPortFile } from "@bizshuffle-bun/client-host";
import { BizShuffleServer } from "@bizshuffle-bun/server-host";
import { FakeLuaPeer } from "../fakes/fake-lua-peer.js";

describe("ClientRuntime bizhawk disconnect", () => {
  let dataDir: string;
  let clientDir: string;
  let server: BizShuffleServer;
  let peer: FakeLuaPeer | null = null;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-srv-"));
    clientDir = mkdtempSync(join(tmpdir(), "bizshuffle-cli-"));
    server = new BizShuffleServer({ dataDir, host: "127.0.0.1", port: 0 });
    await server.start();
  });

  afterEach(async () => {
    peer?.stop();
    peer = null;
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(clientDir, { recursive: true, force: true });
  });

  it("disconnects from server when lua ipc is lost after ready", async () => {
    peer = await FakeLuaPeer.listen({ savesDir: clientDir, instanceId: "lost-inst" });
    writeLuaPortFile(join(clientDir, "lua_server_port.txt"), peer.port);

    const runtime = new ClientRuntime({
      dataDir: clientDir,
      serverUrl: server.url,
      playerName: "drop-player",
      enableDiscovery: false,
      luaPort: peer.port,
    });

    await runtime.start();
    await runtime.waitForBizhawkIpc();

    const ready = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { players: Record<string, { connected: boolean; bizhawk_ready: boolean }> };
    };
    expect(ready.state.players["drop-player"]?.connected).toBe(true);
    expect(ready.state.players["drop-player"]?.bizhawk_ready).toBe(true);

    peer.stop();
    peer = null;
    await new Promise((r) => setTimeout(r, 200));

    expect(runtime.isConnected).toBe(false);

    const after = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { players: Record<string, { connected: boolean; bizhawk_ready: boolean }> };
    };
    expect(after.state.players["drop-player"]?.connected).toBe(false);
    expect(after.state.players["drop-player"]?.bizhawk_ready).toBe(false);

    runtime.stop();
  }, 25_000);
});
