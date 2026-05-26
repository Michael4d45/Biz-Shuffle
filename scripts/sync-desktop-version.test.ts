import { describe, expect, it } from "bun:test";
import { readDesktopVersions, syncDesktopVersion } from "./sync-desktop-version.js";

describe("syncDesktopVersion", () => {
  it("is a no-op when package.json and electrobun.config already match", () => {
    const { packageJson } = readDesktopVersions();
    const version = syncDesktopVersion(packageJson);
    expect(version).toBe(packageJson);
    expect(readDesktopVersions().packageJson).toBe(packageJson);
    expect(readDesktopVersions().electrobunConfig).toBe(packageJson);
  });
});
