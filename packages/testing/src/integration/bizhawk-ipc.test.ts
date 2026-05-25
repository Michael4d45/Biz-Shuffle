import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BizhawkIpc, writeLuaPortFile } from "@bizshuffle-bun/client-host";
import { FakeLuaPeer } from "../fakes/fake-lua-peer.js";

describe("BizhawkIpc + FakeLuaPeer integration", () => {
  let dataDir: string;
  let bipc: BizhawkIpc;
  let peer: FakeLuaPeer | null = null;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-ipc-"));
  });

  afterEach(() => {
    peer?.stop();
    peer = null;
    bipc?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("fake lua listens, controller connects, HELLO + SAVE/SWAP work", async () => {
    peer = await FakeLuaPeer.listen({
      savesDir: dataDir,
      instanceId: "ipc-inst",
    });
    writeLuaPortFile(join(dataDir, "lua_server_port.txt"), peer.port);

    bipc = new BizhawkIpc({ portFile: join(dataDir, "lua_server_port.txt") });
    await bipc.start();

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !bipc.isReady()) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(bipc.isReady()).toBe(true);

    await bipc.sendSave();
    expect(peer.receivedCommands).toContain("SAVE");
    expect(existsSync(join(dataDir, "saves", "ipc-inst.state"))).toBe(true);

    await bipc.sendSwap("game.zip", "ipc-inst");
    expect(peer.receivedCommands).toContain("SWAP");
    expect(peer.instanceId).toBe("ipc-inst");

    await bipc.sendPause();
    expect(peer.receivedCommands).toContain("PAUSE");
  }, 15_000);
});
