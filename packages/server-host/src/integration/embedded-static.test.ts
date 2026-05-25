import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { BizShuffleServer } from "../server.js";

const repoStatic = resolve(fileURLToPath(new URL("../../priv/static", import.meta.url)));

/** Simulates Electrobun: server-host bundled under app/ without copied priv/static. */
describe("embedded desktop static layout", () => {
  it("serves / when staticDir points at built admin", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-embed-"));
    const server = new BizShuffleServer({
      dataDir,
      host: "127.0.0.1",
      port: 0,
      staticDir: repoStatic,
    });
    await server.start();
    try {
      const res = await fetch(`${server.url}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("/assets/");
    } finally {
      await server.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("fails at startup when static is missing (bundled path)", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-embed-"));
    expect(
      () =>
        new BizShuffleServer({
          dataDir,
          host: "127.0.0.1",
          port: 0,
          staticDir: join(dataDir, "nonexistent-static"),
        })
    ).toThrow(/Admin static missing/);
    rmSync(dataDir, { recursive: true, force: true });
  });
});
