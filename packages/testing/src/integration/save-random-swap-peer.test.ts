import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { ClientRuntime, writeLuaPortFile } from "@bizshuffle-bun/client-host";
import { FakeLuaPeer, savePath } from "../fakes/fake-lua-peer.js";
import { startTestServer } from "../test-helpers.js";

const BANJO_ID = "banjo-kazooie--usa-";
const ZELDA_ID = "legend-of-zelda--the";

async function postJson(url: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("save mode peer save on instance takeover", () => {
  let hostDir: string;
  let server: Awaited<ReturnType<typeof startTestServer>>["server"];
  const clientDirs: string[] = [];
  const runtimes: ClientRuntime[] = [];
  const peers: FakeLuaPeer[] = [];

  afterEach(async () => {
    for (const rt of runtimes) rt.stop();
    for (const peer of peers) peer.stop();
    runtimes.length = 0;
    peers.length = 0;
    if (server) await server.stop();
    await new Promise((r) => setTimeout(r, 100));
    if (hostDir) rmSync(hostDir, { recursive: true, force: true });
    for (const dir of clientDirs) rmSync(dir, { recursive: true, force: true });
    clientDirs.length = 0;
  });

  it("swap_player requests save from displaced owner before reassignment", async () => {
    ({ server, dataDir: hostDir } = await startTestServer());
    const base = server.url;
    const romsDir = join(hostDir, "roms");
    mkdirSync(romsDir, { recursive: true });
    writeFileSync(join(romsDir, "Banjo-Kazooie (USA).zip"), Buffer.from("rom"));
    writeFileSync(join(romsDir, "Legend of Zelda, The - Ocarina of Time (USA).zip"), Buffer.from("rom"));

    await postJson(base, "/api/mode", { mode: "save" });
    await postJson(base, "/api/games", {
      main_games: [
        { file: "Banjo-Kazooie (USA).zip" },
        { file: "Legend of Zelda, The - Ocarina of Time (USA).zip" },
      ],
      game_instances: [
        { id: BANJO_ID, game: "Banjo-Kazooie (USA).zip", file_state: "ready" },
        { id: ZELDA_ID, game: "Legend of Zelda, The - Ocarina of Time (USA).zip", file_state: "ready" },
      ],
    });
    await postJson(base, "/api/add_player", { player: "bob" });
    await postJson(base, "/api/add_player", { player: "test" });

    async function startClient(
      playerName: string,
      instanceId: string
    ): Promise<{ runtime: ClientRuntime; peer: FakeLuaPeer }> {
      const clientDir = mkdtempSync(join(tmpdir(), `bizshuffle-peer-${playerName}-`));
      clientDirs.push(clientDir);
      const peer = await FakeLuaPeer.listen({ savesDir: clientDir, instanceId });
      peers.push(peer);
      writeLuaPortFile(join(clientDir, "lua_server_port.txt"), peer.port);
      const runtime = new ClientRuntime({
        dataDir: clientDir,
        serverUrl: base,
        playerName,
        enableDiscovery: false,
        enableBizhawkIpc: true,
        luaPort: peer.port,
      });
      await runtime.start();
      await runtime.waitForBizhawkIpc(20_000);
      runtimes.push(runtime);
      return { runtime, peer };
    }

    const { peer: bobPeer } = await startClient("bob", BANJO_ID);
    await startClient("test", ZELDA_ID);

    server.updateStateAndPersist((st) => {
      for (const [name, instanceId, game] of [
        ["bob", BANJO_ID, "Banjo-Kazooie (USA).zip"],
        ["test", ZELDA_ID, "Legend of Zelda, The - Ocarina of Time (USA).zip"],
      ] as const) {
        const p = st.players[name]!;
        p.game = game;
        p.instance_id = instanceId;
        p.connected = true;
        p.bizhawk_ready = true;
        st.players[name] = p;
      }
    });

    const settleDeadline = Date.now() + 15_000;
    while (Date.now() < settleDeadline && server.pendingCommandCount > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const savesBefore = bobPeer.receivedCommands.filter((c) => c === "SAVE").length;

    const res = await postJson(base, "/api/swap_player", {
      player: "test",
      instance_id: BANJO_ID,
    });
    expect(res.status).toBe(200);

    const deadline = Date.now() + 15_000;
    while (
      Date.now() < deadline &&
      bobPeer.receivedCommands.filter((c) => c === "SAVE").length <= savesBefore
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(bobPeer.receivedCommands.filter((c) => c === "SAVE").length).toBeGreaterThan(
      savesBefore
    );
    expect(existsSync(savePath(hostDir, BANJO_ID))).toBe(true);
    expect(server.snapshotState().players.test?.instance_id).toBe(BANJO_ID);
  }, 90_000);
});
