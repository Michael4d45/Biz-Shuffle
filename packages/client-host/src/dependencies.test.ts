import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { isManagedBizHawkPath } from "./bizhawk-setup.js";
import { getDependenciesSnapshot } from "./dependencies.js";

describe("dependencies", () => {
  it("treats only managed install paths as in-scope", () => {
    const dataDir =
      process.platform === "win32" ? "C:\\Users\\me\\BizShuffle" : "/home/me/BizShuffle";
    const managedExe = join(
      dataDir,
      "BizHawk",
      process.platform === "win32" ? "EmuHawk.exe" : "EmuHawk"
    );
    const externalExe =
      process.platform === "win32"
        ? "C:\\Program Files\\BizHawk\\EmuHawk.exe"
        : "/opt/BizHawk/EmuHawk";
    expect(isManagedBizHawkPath(dataDir, managedExe)).toBe(true);
    expect(isManagedBizHawkPath(dataDir, externalExe)).toBe(false);
  });

  it("returns no panel items when BizHawk and VC++ are satisfied", () => {
    const snap = getDependenciesSnapshot("/nonexistent-empty-dir-xyz");
    expect(snap.items.some((i) => i.id === "bizhawk")).toBe(true);
    expect(snap.playBlocked).toBe(true);
  });
});
