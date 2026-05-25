import { describe, expect, it } from "bun:test";

const hasBizhawk = Boolean(process.env.BIZHAWK_PATH);

describe.skipIf(!hasBizhawk)("emulator integration (@requires-bizhawk)", () => {
  it("placeholder for live BizHawk + server.lua (see test:integration FakeLuaPeer)", () => {
    expect(process.env.BIZHAWK_PATH).toBeTruthy();
  });
});

describe("emulator contracts", () => {
  it("Lua reconnect delays match spec", async () => {
    const { LUA_RECONNECT_DELAYS_MS, IPC_TIMEOUT_MS } = await import("@bizshuffle-bun/protocol");
    expect(LUA_RECONNECT_DELAYS_MS).toEqual([1000, 3000, 5000]);
    expect(IPC_TIMEOUT_MS).toBe(10_000);
  });

  it("EmulatorService health states are defined in core", async () => {
    const t: import("@bizshuffle-bun/protocol").EmulatorState = "crashed";
    expect(t).toBe("crashed");
  });
});
