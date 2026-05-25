import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { MIN_SAVE_ZIP } from "../fakes/fake-lua-peer.js";
import { startTestServer, stopTestServer } from "../test-helpers.js";

describe("save state file management integration", () => {
  let dataDir: string;
  let server: Awaited<ReturnType<typeof startTestServer>>["server"];

  afterEach(async () => {
    if (server) await stopTestServer(server, dataDir);
  });

  it("upload sets file_state ready and GET /save serves the file", async () => {
    ({ server, dataDir } = await startTestServer());
    const instanceId = "mario-1";

    await fetch(`${server.url}/api/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game_instances: [{ id: instanceId, game: "mario.zip", file_state: "none" }],
      }),
    });

    const form = new FormData();
    form.append("save", new Blob([MIN_SAVE_ZIP]), `${instanceId}.state`);
    form.append("filename", `${instanceId}.state`);
    const upload = await fetch(`${server.url}/save/upload`, { method: "POST", body: form });
    expect(upload.status).toBe(200);

    const st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { game_instances: Array<{ id: string; file_state: string }> };
    };
    const inst = st.state.game_instances.find((i) => i.id === instanceId);
    expect(inst?.file_state).toBe("ready");

    const download = await fetch(`${server.url}/save/${instanceId}.state`);
    expect(download.status).toBe(200);
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.equals(MIN_SAVE_ZIP)).toBe(true);
    expect(existsSync(join(dataDir, "saves", `${instanceId}.state`))).toBe(true);
  });

  it("clear_saves removes host save directory contents", async () => {
    ({ server, dataDir } = await startTestServer());
    const savesDir = join(dataDir, "saves");
    const form = new FormData();
    form.append("save", new Blob([MIN_SAVE_ZIP]), "a.state");
    form.append("filename", "a.state");
    await fetch(`${server.url}/save/upload`, { method: "POST", body: form });
    expect(existsSync(join(savesDir, "a.state"))).toBe(true);

    const cleared = await fetch(`${server.url}/api/clear_saves`, { method: "POST" });
    expect(cleared.status).toBe(200);
    expect(existsSync(join(savesDir, "a.state"))).toBe(false);
  });

  it("POST /save/no-save marks instance as none", async () => {
    ({ server, dataDir } = await startTestServer());
    const instanceId = "nosave-1";

    await fetch(`${server.url}/api/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game_instances: [{ id: instanceId, game: "x.zip", file_state: "pending" }],
      }),
    });

    const res = await fetch(`${server.url}/save/no-save`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `instance_id=${encodeURIComponent(instanceId)}`,
    });
    expect(res.status).toBe(200);

    const st = (await fetch(`${server.url}/state.json`).then((r) => r.json())) as {
      state: { game_instances: Array<{ id: string; file_state: string }> };
    };
    expect(st.state.game_instances.find((i) => i.id === instanceId)?.file_state).toBe("none");
  });
});
