import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { BizShuffleServer } from "../server.js";

describe("rom catalog seeding", () => {
  let dataDir: string;
  let server: BizShuffleServer;

  afterEach(async () => {
    await server?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("seeds games from ./roms on server start when catalog is empty", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-rom-seed-"));
    mkdirSync(join(dataDir, "roms"), { recursive: true });
    writeFileSync(join(dataDir, "roms", "test-game.zip"), "fake");

    server = new BizShuffleServer({ dataDir, host: "127.0.0.1", port: 0 });
    await server.start();

    const st = server.snapshotState();
    expect(st.main_games?.some((g) => g.file === "test-game.zip")).toBe(true);
    expect(st.games).toContain("test-game.zip");
  });
});
