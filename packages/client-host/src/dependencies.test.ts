import { describe, expect, it } from "bun:test";
import { isManagedBizHawkPath } from "./bizhawk-setup.js";
import { getDependenciesSnapshot } from "./dependencies.js";

describe("dependencies", () => {
  it("treats only managed install paths as in-scope", () => {
    const dataDir = "C:\\Users\\me\\BizShuffle";
    expect(isManagedBizHawkPath(dataDir, "C:\\Users\\me\\BizShuffle\\BizHawk\\EmuHawk.exe")).toBe(
      true
    );
    expect(isManagedBizHawkPath(dataDir, "C:\\Program Files\\BizHawk\\EmuHawk.exe")).toBe(false);
  });

  it("returns no panel items when BizHawk and VC++ are satisfied", () => {
    const snap = getDependenciesSnapshot("/nonexistent-empty-dir-xyz");
    expect(snap.items.some((i) => i.id === "bizhawk")).toBe(true);
    expect(snap.playBlocked).toBe(true);
  });
});
