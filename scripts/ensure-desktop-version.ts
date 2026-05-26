#!/usr/bin/env bun
/**
 * CI: sync version from GITHUB_REF_NAME before release build.
 * Local: verify package.json and electrobun.config versions match (no manual sync in CI).
 */
import { readDesktopVersions, syncDesktopVersion, normalizeVersion } from "./sync-desktop-version.js";

const tag = process.env.GITHUB_REF_NAME?.trim();

if (tag) {
  const version = syncDesktopVersion(tag);
  console.log(`Desktop version synced from tag: ${version}`);
  process.exit(0);
}

const { packageJson, electrobunConfig } = readDesktopVersions();
if (packageJson === electrobunConfig) {
  console.log(`Desktop version OK: ${packageJson}`);
  process.exit(0);
}

console.error(
  `Desktop version mismatch: package.json=${packageJson} electrobun.config=${electrobunConfig}`
);
console.error("Release builds: push a v* tag (CI syncs automatically).");
console.error("Local fix: bun run sync-desktop-version", normalizeVersion(packageJson));
process.exit(1);
