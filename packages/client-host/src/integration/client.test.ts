import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BizShuffleServer } from "@bizshuffle-bun/server-host";
import { ClientRuntime } from "../runtime.js";

describe("ClientRuntime integration", () => {
  let dataDir: string;
  let server: BizShuffleServer;
  let clientDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-srv-"));
    clientDir = mkdtempSync(join(tmpdir(), "bizshuffle-cli-"));
    server = new BizShuffleServer({ dataDir, host: "127.0.0.1", port: 0 });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(clientDir, { recursive: true, force: true });
  });

  it("connects and registers player", async () => {
    const runtime = new ClientRuntime({
      dataDir: clientDir,
      serverUrl: server.url,
      playerName: "integration-player",
      enableDiscovery: false,
      enableBizhawkIpc: false,
    });

    await runtime.start();
    expect(runtime.isConnected).toBe(true);

    const st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { players: Record<string, { connected: boolean }> };
    };
    expect(st.state.players["integration-player"]?.connected).toBe(true);

    runtime.stop();
  }, 20_000);
});
