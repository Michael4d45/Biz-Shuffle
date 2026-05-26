import { describe, expect, it } from "bun:test";
import {
  SUPPORTED_BIZHAWK_VERSION,
  bizHawkNeedsUpdate,
  compareBizHawkVersions,
  detectInstalledBizHawkVersion,
} from "./bizhawk-version.js";

describe("bizhawk-version", () => {
  it("compares dotted versions", () => {
    expect(compareBizHawkVersions("2.9", "2.10")).toBeLessThan(0);
    expect(compareBizHawkVersions("2.10", "2.10")).toBe(0);
    expect(compareBizHawkVersions("2.11", "2.10")).toBeGreaterThan(0);
  });

  it("detects version from install path", () => {
    expect(
      detectInstalledBizHawkVersion("C:\\BizShuffle\\BizHawk\\BizHawk-2.9-win-x64\\EmuHawk.exe")
    ).toBe("2.9");
    expect(detectInstalledBizHawkVersion("/home/user/BizHawk/BizHawk-2.10-linux-x64/EmuHawk")).toBe(
      "2.10"
    );
  });

  it("flags outdated installs", () => {
    expect(bizHawkNeedsUpdate("2.9", SUPPORTED_BIZHAWK_VERSION)).toBe(true);
    expect(bizHawkNeedsUpdate("2.10", SUPPORTED_BIZHAWK_VERSION)).toBe(true);
    expect(bizHawkNeedsUpdate("2.11.1", SUPPORTED_BIZHAWK_VERSION)).toBe(false);
    expect(bizHawkNeedsUpdate(null, SUPPORTED_BIZHAWK_VERSION)).toBe(false);
  });
});
