import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import WebSocket from "ws";
import { BizShuffleServer } from "../server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("hello player assignment", () => {
  let dataDir: string;
  let server: BizShuffleServer;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-hello-assign-"));
    server = new BizShuffleServer({ dataDir, host: "127.0.0.1", port: 0 });
    await server.start();
    await fetch(`${server.url}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "save" }),
    });
    await fetch(`${server.url}/api/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game_instances: [{ id: "inst-1", game: "mario.zip", file_state: "none" }],
      }),
    });
  });

  afterEach(async () => {
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("assigns save-mode instance on hello and sends swap when bizhawk is ready", async () => {
    const wsUrl = server.url.replace("http://", "ws://") + "/ws";
    const ws = new WebSocket(wsUrl);
    const swaps: Array<{ game?: string; instance_id?: string }> = [];

    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
      ws.on("message", (raw) => {
        try {
          const cmd = JSON.parse(raw.toString()) as {
            cmd?: string;
            id?: string;
            payload?: { game?: string; instance_id?: string };
          };
          if (cmd.cmd === "swap") {
            swaps.push(cmd.payload ?? {});
            if (cmd.id) ws.send(JSON.stringify({ cmd: "ack", id: cmd.id }));
          }
        } catch {
          /* ignore */
        }
      });
    });

    ws.send(
      JSON.stringify({
        cmd: "hello",
        id: "hello-1",
        payload: { name: "joiner", bizhawk_ready: true },
      })
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for swap")), 5000);
      const check = setInterval(() => {
        if (swaps.length > 0) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
      }, 25);
    });

    expect(swaps[0]?.game).toBe("mario.zip");
    expect(swaps[0]?.instance_id).toBe("inst-1");

    const st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { players: Record<string, { game?: string; instance_id?: string }> };
    };
    expect(st.state.players.joiner?.game).toBe("mario.zip");
    expect(st.state.players.joiner?.instance_id).toBe("inst-1");

    ws.close();
  });

  it("defers swap until bizhawk becomes ready and does not duplicate", async () => {
    const wsUrl = server.url.replace("http://", "ws://") + "/ws";
    const ws = new WebSocket(wsUrl);
    const swapIds: string[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
      ws.on("message", (raw) => {
        try {
          const cmd = JSON.parse(raw.toString()) as { cmd?: string; id?: string };
          if (cmd.cmd === "swap" && cmd.id) {
            swapIds.push(cmd.id);
            ws.send(JSON.stringify({ cmd: "ack", id: cmd.id }));
          }
        } catch {
          /* ignore */
        }
      });
    });

    ws.send(
      JSON.stringify({
        cmd: "hello",
        id: "hello-1",
        payload: { name: "late-ready", bizhawk_ready: false },
      })
    );

    await new Promise((r) => setTimeout(r, 200));
    expect(swapIds.length).toBe(0);

    ws.send(
      JSON.stringify({
        cmd: "status_update",
        id: "status-1",
        payload: { bizhawk_ready: true },
      })
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for swap")), 5000);
      const check = setInterval(() => {
        if (swapIds.length >= 1) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
      }, 25);
    });

    ws.send(
      JSON.stringify({
        cmd: "status_update",
        id: "status-2",
        payload: { bizhawk_ready: true },
      })
    );

    await new Promise((r) => setTimeout(r, 200));
    expect(swapIds.length).toBe(1);

    ws.close();
  });
});
