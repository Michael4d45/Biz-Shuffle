#!/usr/bin/env bun
/**
 * Set apps/desktop version from a release tag (e.g. GITHUB_REF_NAME=v0.0.9 → 0.0.9).
 * Keeps electrobun.config app.version and package.json in sync for updater + version.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const desktopDir = join(root, "apps/desktop");

function resolveVersion(): string {
  const fromArg = process.argv[2]?.trim();
  if (fromArg) return fromArg.replace(/^v/, "");
  const fromEnv = process.env.GITHUB_REF_NAME?.trim();
  if (fromEnv) return fromEnv.replace(/^v/, "");
  console.error("Usage: bun run scripts/sync-desktop-version.ts <version|vX.Y.Z>");
  console.error("  or set GITHUB_REF_NAME=vX.Y.Z");
  process.exit(1);
}

const version = resolveVersion();
if (!/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
  console.error(`Invalid semver: ${version}`);
  process.exit(1);
}

const pkgPath = join(desktopDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const configPath = join(desktopDir, "electrobun.config.ts");
const configText = readFileSync(configPath, "utf8");
const nextConfig = configText.replace(/version:\s*"[^"]*"/, `version: "${version}"`);
if (nextConfig === configText) {
  console.error(`Could not update app.version in ${configPath}`);
  process.exit(1);
}
writeFileSync(configPath, nextConfig);

console.log(`Desktop version set to ${version}`);
