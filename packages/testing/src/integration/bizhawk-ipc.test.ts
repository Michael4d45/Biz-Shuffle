import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { LuaCommand } from "@bizshuffle-bun/protocol";
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

    await bipc.sendMessage("hello", {
      duration: 5,
      x: 76,
      y: 10,
      fontsize: 40,
      fg: "#ff0000",
      bg: "#000000",
    });
    expect(peer.lastCmdParts[2]).toBe("MSG");
    expect(peer.lastCmdParts[3]).toBe("hello");
    expect(peer.lastCmdParts[4]).toBe("5");
    expect(peer.lastCmdParts[5]).toBe("76");
    expect(peer.lastCmdParts[6]).toBe("10");
    expect(peer.lastCmdParts[7]).toBe("40");
    expect(peer.lastCmdParts[8]).toBe("#ff0000");
    expect(peer.lastCmdParts[9]).toBe("#000000");
  }, 15_000);

  it("forwards plugin SendCommand lines via onLuaCommand", async () => {
    const received: LuaCommand[] = [];
    peer = await FakeLuaPeer.listen({ savesDir: dataDir });
    writeLuaPortFile(join(dataDir, "lua_server_port.txt"), peer.port);

    bipc = new BizhawkIpc({
      portFile: join(dataDir, "lua_server_port.txt"),
      onLuaCommand: (cmd) => received.push(cmd),
    });
    await bipc.start();

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !bipc.isReady()) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(bipc.isReady()).toBe(true);

    peer.emitPluginCommand(
      "CMD|swap_me|message=Memory Tracker: test door 32792 -> 32785 (Location change)"
    );
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    expect(received[0]?.Kind).toBe("swap_me");
    expect(received[0]?.Fields.message).toContain("32792 -> 32785");
  }, 15_000);
});
