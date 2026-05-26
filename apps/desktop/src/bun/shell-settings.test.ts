import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { loadShellSettings, saveShellSettings } from "./shell-settings.js";

describe("shell-settings", () => {
  it("round-trips settings.json", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-shell-settings-"));
    saveShellSettings(dataDir, {
      bindHost: "0.0.0.0",
      serverUrl: "http://192.168.1.10:9090",
      playerName: "Alice",
    });
    const loaded = loadShellSettings(dataDir);
    expect(loaded.bindHost).toBe("0.0.0.0");
    expect(loaded.serverUrl).toBe("http://192.168.1.10:9090");
    expect(loaded.playerName).toBe("Alice");
    const raw = JSON.parse(readFileSync(join(dataDir, "settings.json"), "utf8")) as {
      playerName: string;
    };
    expect(raw.playerName).toBe("Alice");
  });

  it("merges partial updates", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-shell-settings-"));
    saveShellSettings(dataDir, { bindHost: "127.0.0.1", serverUrl: "http://127.0.0.1:8080" });
    saveShellSettings(dataDir, { playerName: "Bob" });
    expect(loadShellSettings(dataDir).playerName).toBe("Bob");
    expect(loadShellSettings(dataDir).serverUrl).toBe("http://127.0.0.1:8080");
  });
});
