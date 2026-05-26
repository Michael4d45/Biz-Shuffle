import { describe, expect, it, vi } from "bun:test";
import type { Command } from "@bizshuffle-bun/protocol";
import { Controller } from "./controller.js";
import type { ClientApiPort } from "./api.js";
import type { BizhawkIpc } from "./bizhawk-ipc.js";

function mockApi(baseUrl: string): ClientApiPort {
  return {
    baseUrl,
    getState: vi.fn(),
    getPlugins: vi.fn(),
    uploadSave: vi.fn(),
  };
}

describe("Controller", () => {
  it("acks pause without ipc", async () => {
    const sent: Command[] = [];
    const controller = new Controller({
      dataDir: "/tmp",
      api: mockApi("http://x"),
      bipc: null,
      pluginsDir: "/tmp/plugins",
      send: async (cmd) => {
        sent.push(cmd);
      },
    });
    await controller.handle({ cmd: "pause", id: "p1" });
    expect(sent.some((c) => c.cmd === "ack" && c.id === "p1")).toBe(true);
  });

  it("sends games_update_ack after games_update", async () => {
    const sent: Command[] = [];
    const controller = new Controller({
      dataDir: "/tmp",
      api: mockApi("http://x"),
      bipc: null,
      pluginsDir: "/tmp/plugins",
      send: async (cmd) => {
        sent.push(cmd);
      },
    });
    await controller.handle({
      cmd: "games_update",
      id: "g1",
      payload: { games: [], game_instances: [], main_games: [] },
    });
    expect(sent.some((c) => c.cmd === "games_update_ack")).toBe(true);
  });

  it("nacks swap when download fails", async () => {
    const sent: Command[] = [];
    const controller = new Controller({
      dataDir: "/tmp",
      api: mockApi("http://127.0.0.1:1"),
      bipc: null,
      pluginsDir: "/tmp/plugins",
      send: async (cmd) => {
        sent.push(cmd);
      },
    });
    await controller.handle({
      cmd: "swap",
      id: "s1",
      payload: { game: "missing.rom" },
    });
    expect(sent.some((c) => c.cmd === "nack" && c.id === "s1")).toBe(true);
  });

  it("defers swap until ipc is ready", async () => {
    const sent: Command[] = [];
    let ready = false;
    const bipc = {
      isReady: () => ready,
      sendPause: vi.fn(),
      sendResume: vi.fn(),
      sendSwap: vi.fn().mockResolvedValue(undefined),
      sendSave: vi.fn(),
      sendMessage: vi.fn(),
    } as unknown as BizhawkIpc;
    const controller = new Controller({
      dataDir: "/tmp",
      api: mockApi("http://127.0.0.1:1"),
      bipc,
      pluginsDir: "/tmp/plugins",
      send: async (cmd) => {
        sent.push(cmd);
      },
    });
    await controller.handle({
      cmd: "swap",
      id: "s-defer",
      payload: { instance_id: "inst-1" },
    });
    expect(sent.some((c) => c.cmd === "ack")).toBe(false);

    ready = true;
    await controller.onBizhawkReady();
    expect(bipc.sendSave).toHaveBeenCalled();
    expect(sent.some((c) => c.cmd === "ack" && c.id === "s-defer")).toBe(true);
  });

  it("acks pause with mock ipc", async () => {
    const bipc = {
      isReady: () => true,
      sendPause: vi.fn().mockResolvedValue(undefined),
      sendResume: vi.fn(),
      sendSwap: vi.fn(),
      sendMessage: vi.fn(),
      sendSave: vi.fn(),
    } as unknown as BizhawkIpc;
    const sent: Command[] = [];
    const controller = new Controller({
      dataDir: "/tmp",
      api: mockApi("http://x"),
      bipc,
      pluginsDir: "/tmp/plugins",
      send: async (cmd) => {
        sent.push(cmd);
      },
    });
    await controller.handle({ cmd: "pause", id: "p2" });
    expect(bipc.sendPause).toHaveBeenCalled();
    expect(sent.some((c) => c.cmd === "ack")).toBe(true);
  });
});
