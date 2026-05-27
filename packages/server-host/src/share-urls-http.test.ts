import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { BizShuffleServer } from "./server.js";

describe("GET /api/share_urls", () => {
  const servers: BizShuffleServer[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()!.stop();
    }
  });

  it("uses socket bind host, not loopback display host", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-share-urls-"));
    const server = new BizShuffleServer({ dataDir, host: "0.0.0.0", port: 0 });
    servers.push(server);
    await server.start();
    expect(server.getBindHost()).toBe("0.0.0.0");
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/);

    const res = await fetch(`${server.url}/api/share_urls`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      lan: string[];
      wan: string | null;
      local_only: boolean;
    };
    expect(body.local_only).toBe(false);
    expect(body.lan.length).toBeGreaterThan(0);
  });
});
