import { describe, expect, it } from "bun:test";
import { startTestServer, stopTestServer } from "../test-helpers.js";
import { WsTestClient, httpToWs } from "../ws-test-client.js";

describe("e2e (TS-only smoke)", () => {
  it("create session, join, start, pause", async () => {
    const { server, dataDir } = await startTestServer();
    try {
      const client = new WsTestClient(httpToWs(server.url));
      await client.connect();
      await client.hello("ts-e2e");
      await fetch(`${server.url}/api/start`, { method: "POST" });
      await fetch(`${server.url}/api/pause`, { method: "POST" });
      const st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
        state: { running: boolean; players: Record<string, unknown> };
      };
      expect(st.state.running).toBe(false);
      expect(st.state.players["ts-e2e"]).toBeDefined();
      client.close();
    } finally {
      await stopTestServer(server, dataDir);
    }
  });
});
