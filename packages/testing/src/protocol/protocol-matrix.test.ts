import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { BizShuffleServer } from "@bizshuffle-bun/server-host";
import { startTestServer, stopTestServer } from "../test-helpers.js";
import { WsTestClient, httpToWs } from "../ws-test-client.js";

describe("protocol matrix — TS server", () => {
  let dataDir: string;
  let server: BizShuffleServer;

  beforeEach(async () => {
    ({ server, dataDir } = await startTestServer());
  });

  afterEach(async () => {
    await stopTestServer(server, dataDir);
  });

  it("player hello + games_update", async () => {
    const client = new WsTestClient(httpToWs(server.url));
    await client.connect();
    await client.hello("matrix-player");
    const st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { players: Record<string, { connected: boolean }> };
    };
    expect(st.state.players["matrix-player"]?.connected).toBe(true);
    client.close();
  });

  it("admin hello_admin", async () => {
    const client = new WsTestClient(httpToWs(server.url));
    await client.connect();
    await client.helloAdmin("test-admin");
    client.close();
  });

  it("start/pause over HTTP", async () => {
    let res = await fetch(`${server.url}/api/start`, { method: "POST" });
    expect(res.status).toBe(200);
    let body = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { running: boolean };
    };
    expect(body.state.running).toBe(true);

    res = await fetch(`${server.url}/api/pause`, { method: "POST" });
    expect(res.status).toBe(200);
    body = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { running: boolean };
    };
    expect(body.state.running).toBe(false);
  });
});
