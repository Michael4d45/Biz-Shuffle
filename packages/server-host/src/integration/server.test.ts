import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import WebSocket from "ws";
import { BizShuffleServer } from "../server.js";

function autoAck(ws: WebSocket): void {
  ws.on("message", (raw) => {
    try {
      const cmd = JSON.parse(raw.toString()) as { cmd?: string; id?: string };
      if (cmd.id && cmd.cmd && cmd.cmd !== "ack" && cmd.cmd !== "nack") {
        ws.send(JSON.stringify({ cmd: "ack", id: cmd.id }));
      }
    } catch {
      /* ignore */
    }
  });
}

describe("BizShuffleServer integration", () => {
  let dataDir: string;
  let server: BizShuffleServer;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-bun-server-"));
    server = new BizShuffleServer({ dataDir, host: "127.0.0.1", port: 0 });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    await new Promise((r) => setTimeout(r, 50));
    rmSync(dataDir, { recursive: true, force: true });
  }, 15000);

  it("serves admin static assets", async () => {
    const home = await fetch(`${server.url}/`);
    expect(home.status).toBe(200);
    const html = await home.text();
    const match = html.match(/src="(\/assets\/[^"]+)"/);
    expect(match).toBeTruthy();
    const asset = await fetch(`${server.url}${match![1]}`);
    expect(asset.status).toBe(200);
  });

  it("serves state.json", async () => {
    const res = await fetch(`${server.url}/state.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { running: boolean } };
    expect(body.state).toBeDefined();
    expect(body.state.running).toBe(false);
  });

  it("handles hello over websocket", async () => {
    const wsUrl = server.url.replace("http://", "ws://") + "/ws";
    const ws = new WebSocket(wsUrl);
    autoAck(ws);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    ws.send(
      JSON.stringify({
        cmd: "hello",
        id: "hello-1",
        payload: { name: "test-player", bizhawk_ready: true },
      })
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for messages")), 5000);
      ws.on("message", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { players: Record<string, { connected: boolean; bizhawk_ready: boolean }> };
    };
    expect(st.state.players["test-player"]?.connected).toBe(true);
    expect(st.state.players["test-player"]?.bizhawk_ready).toBe(true);
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      ws.close();
      setTimeout(resolve, 500);
    });

    const afterClose = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { players: Record<string, { connected: boolean; bizhawk_ready: boolean }> };
    };
    expect(afterClose.state.players["test-player"]?.connected).toBe(false);
    expect(afterClose.state.players["test-player"]?.bizhawk_ready).toBe(false);
  }, 10000);

  it("start and pause via HTTP API", async () => {
    let res = await fetch(`${server.url}/api/start`, { method: "POST" });
    expect(res.status).toBe(200);
    let st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { running: boolean };
    };
    expect(st.state.running).toBe(true);

    res = await fetch(`${server.url}/api/pause`, { method: "POST" });
    expect(res.status).toBe(200);
    st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { running: boolean };
    };
    expect(st.state.running).toBe(false);
  });
});
