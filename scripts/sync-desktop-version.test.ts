import { describe, expect, it } from "bun:test";
import {
  patchLockfileDesktopVersion,
  readDesktopVersions,
  syncDesktopVersion,
} from "./sync-desktop-version.js";

const SAMPLE_LOCK = `{
  "workspaces": {
    "apps/desktop": {
      "name": "@bizshuffle-bun/desktop",
      "version": "0.0.14",
    },
  },
}`;

describe("patchLockfileDesktopVersion", () => {
  it("updates the apps/desktop workspace version", () => {
    const next = patchLockfileDesktopVersion(SAMPLE_LOCK, "0.0.16");
    expect(next).toContain('"version": "0.0.16"');
    expect(next).not.toContain('"version": "0.0.14"');
  });
});

describe("syncDesktopVersion", () => {
  it("is a no-op when package.json, electrobun.config, and bun.lock already match", () => {
    const { packageJson } = readDesktopVersions();
    const version = syncDesktopVersion(packageJson);
    expect(version).toBe(packageJson);
    const after = readDesktopVersions();
    expect(after.packageJson).toBe(packageJson);
    expect(after.electrobunConfig).toBe(packageJson);
    expect(after.lockfile).toBe(packageJson);
  });
});
