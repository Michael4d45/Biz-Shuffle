import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { ClientRuntime, writeLuaPortFile } from "@bizshuffle-bun/client-host";
import { FakeLuaPeer, savePath } from "../fakes/fake-lua-peer.js";
import { startTestServer } from "../test-helpers.js";

const BANJO_ID = "banjo-kazooie--usa-";
const CHRONO_ID = "chrono-trigger--usa-";

async function postJson(url: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("save mode two-player swap", () => {
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

  it("performSwap collects uploads before reassigning players", async () => {
    ({ server, dataDir: hostDir } = await startTestServer());
    const base = server.url;
    const romsDir = join(hostDir, "roms");
    mkdirSync(romsDir, { recursive: true });
    writeFileSync(join(romsDir, "Banjo-Kazooie (USA).zip"), Buffer.from("rom"));
    writeFileSync(join(romsDir, "Chrono Trigger (USA).zip"), Buffer.from("rom"));

    await postJson(base, "/api/mode", { mode: "save" });
    await postJson(base, "/api/games", {
      main_games: [
        { file: "Banjo-Kazooie (USA).zip" },
        { file: "Chrono Trigger (USA).zip" },
      ],
      game_instances: [
        { id: BANJO_ID, game: "Banjo-Kazooie (USA).zip", file_state: "none" },
        { id: CHRONO_ID, game: "Chrono Trigger (USA).zip", file_state: "none" },
      ],
    });
    await postJson(base, "/api/add_player", { player: "bob" });
    await postJson(base, "/api/add_player", { player: "test" });

    async function startClient(
      playerName: string,
      instanceId: string
    ): Promise<{ runtime: ClientRuntime; peer: FakeLuaPeer }> {
      const clientDir = mkdtempSync(join(tmpdir(), `bizshuffle-swap-${playerName}-`));
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

    await startClient("bob", BANJO_ID);
    await startClient("test", CHRONO_ID);

    server.updateStateAndPersist((st) => {
      for (const [name, instanceId, game] of [
        ["bob", BANJO_ID, "Banjo-Kazooie (USA).zip"],
        ["test", CHRONO_ID, "Chrono Trigger (USA).zip"],
      ] as const) {
        const p = st.players[name]!;
        p.game = game;
        p.instance_id = instanceId;
        p.connected = true;
        p.bizhawk_ready = true;
        st.players[name] = p;
      }
    });

    await server.performSwap();

    expect(peers[0]!.receivedCommands).toContain("SAVE");
    expect(peers[1]!.receivedCommands).toContain("SAVE");

    const st = server.snapshotState();
    const states = (st.game_instances ?? []).map((i) => i.file_state);
    expect(states).toEqual(["ready", "ready"]);
    expect(st.players.bob?.game).toContain("Chrono");
    expect(st.players.test?.game).toContain("Banjo");

    expect(existsSync(savePath(hostDir, BANJO_ID))).toBe(true);
    expect(existsSync(savePath(hostDir, CHRONO_ID))).toBe(true);
  }, 90_000);
});
