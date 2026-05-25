import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { httpBaseFromServer, loadConfig, saveConfig, wsUrlFromHttpBase } from "./config.js";

describe("client config", () => {
  it("loads missing config as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "bizshuffle-cfg-"));
    try {
      expect(loadConfig(dir)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "bizshuffle-cfg-"));
    try {
      saveConfig(dir, { server: "http://127.0.0.1:8080", name: "p1" });
      const cfg = loadConfig(dir);
      expect(cfg.name).toBe("p1");
      expect(cfg.server).toBe("http://127.0.0.1:8080");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalizes ws server URL", () => {
    expect(httpBaseFromServer("ws://127.0.0.1:9000/ws")).toBe("http://127.0.0.1:9000");
    expect(wsUrlFromHttpBase("http://127.0.0.1:9000")).toBe("ws://127.0.0.1:9000/ws");
  });
});
