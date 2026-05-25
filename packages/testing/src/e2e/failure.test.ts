import { describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer } from "../test-helpers.js";
import { WsTestClient, httpToWs } from "../ws-test-client.js";

describe("failure scenarios (TS server)", () => {
  it("WS disconnect: player marked offline", async () => {
    const { server, dataDir } = await startTestServer();
    try {
      const client = new WsTestClient(httpToWs(server.url));
      await client.connect();
      await client.hello("fail-player");
      client.close();
      await new Promise((r) => setTimeout(r, 500));
      const st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
        state: { players: Record<string, { connected: boolean }> };
      };
      expect(st.state.players["fail-player"]?.connected).toBe(false);
    } finally {
      await stopTestServer(server, dataDir);
    }
  });

  it("server survives after bad WS payload", async () => {
    const { server, dataDir } = await startTestServer();
    try {
      const client = new WsTestClient(httpToWs(server.url));
      await client.connect();
      client.sendRaw("not-json");
      const res = await fetch(`${server.url}/state.json`);
      expect(res.status).toBe(200);
      client.close();
    } finally {
      await stopTestServer(server, dataDir);
    }
  });
});
