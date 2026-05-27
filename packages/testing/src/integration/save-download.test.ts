import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { ensureSaveFile } from "@bizshuffle-bun/client-host";
import { buildMinimalBizHawkSavestate } from "@bizshuffle-bun/savestate";
import { startTestServer, stopTestServer } from "../test-helpers.js";

describe("ensureSaveFile", () => {
  let hostDir: string;
  let clientDir: string;
  let server: Awaited<ReturnType<typeof startTestServer>>["server"];

  afterEach(async () => {
    if (server) await stopTestServer(server, hostDir);
    if (clientDir) rmSync(clientDir, { recursive: true, force: true });
  });

  it("overwrites a stale local save with the host copy", async () => {
    ({ server, dataDir: hostDir } = await startTestServer());
    clientDir = mkdtempSync(join(tmpdir(), "bizshuffle-save-dl-"));
    const instanceId = "overwrite-inst";
    const hostBytes = Buffer.from(buildMinimalBizHawkSavestate());
    const savesDir = join(hostDir, "saves");
    mkdirSync(savesDir, { recursive: true });
    writeFileSync(join(savesDir, `${instanceId}.state`), hostBytes);

    server.updateStateAndPersist((st) => {
      st.game_instances = [{ id: instanceId, game: "game.zip", file_state: "ready" }];
    });

    const localDir = join(clientDir, "saves");
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, `${instanceId}.state`), Buffer.from("stale-local-save"));

    await ensureSaveFile(server.url, clientDir, instanceId);

    const local = readFileSync(join(localDir, `${instanceId}.state`));
    expect(local.equals(hostBytes)).toBe(true);
    expect(existsSync(join(localDir, `${instanceId}.state`))).toBe(true);
  });
});
