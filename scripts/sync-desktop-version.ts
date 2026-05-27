#!/usr/bin/env bun
/**
 * Set apps/desktop version from a release tag (e.g. GITHUB_REF_NAME=v0.0.9 → 0.0.9).
 * Keeps electrobun.config app.version and package.json in sync for updater + version.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const desktopDir = join(root, "apps/desktop");
const pkgPath = join(desktopDir, "package.json");
const configPath = join(desktopDir, "electrobun.config.ts");
const lockPath = join(root, "bun.lock");

/** Workspace entry version under `workspaces["apps/desktop"]` in bun.lock. */
const LOCK_DESKTOP_VERSION_RE = /("apps\/desktop":\s*\{[\s\S]*?\n\s*"version":\s*)"([^"]*)"/;

const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.-]+)?$/;
/** Release tags pushed to CI/CD (e.g. v0.0.10). Branch names like `main` are not tags. */
const RELEASE_TAG_RE = /^v\d+\.\d+\.\d+(-[\w.-]+)?$/;

export function normalizeVersion(input: string): string {
  return input.trim().replace(/^v/, "");
}

export function isReleaseTagRef(ref: string): boolean {
  return RELEASE_TAG_RE.test(ref.trim());
}

export function readLockfileDesktopVersion(lockText = readFileSync(lockPath, "utf8")): string {
  const match = lockText.match(LOCK_DESKTOP_VERSION_RE);
  if (!match?.[2]) {
    throw new Error(`Could not read apps/desktop version from ${lockPath}`);
  }
  return match[2];
}

export function patchLockfileDesktopVersion(lockText: string, version: string): string {
  if (!LOCK_DESKTOP_VERSION_RE.test(lockText)) {
    throw new Error("Could not find apps/desktop version in bun.lock");
  }
  return lockText.replace(LOCK_DESKTOP_VERSION_RE, `$1"${version}"`);
}

export function readDesktopVersions(): {
  packageJson: string;
  electrobunConfig: string;
  lockfile: string;
} {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  const configText = readFileSync(configPath, "utf8");
  const match = configText.match(/version:\s*"([^"]*)"/);
  if (!match?.[1]) {
    throw new Error(`Could not read app.version from ${configPath}`);
  }
  return {
    packageJson: pkg.version,
    electrobunConfig: match[1],
    lockfile: readLockfileDesktopVersion(),
  };
}

export function syncDesktopVersion(versionInput: string): string {
  const version = normalizeVersion(versionInput);
  if (!SEMVER_RE.test(version)) {
    throw new Error(`Invalid semver: ${version}`);
  }

  const current = readDesktopVersions();
  if (
    current.packageJson === version &&
    current.electrobunConfig === version &&
    current.lockfile === version
  ) {
    return version;
  }

  if (current.packageJson !== version) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    pkg.version = version;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  if (current.electrobunConfig !== version) {
    const configText = readFileSync(configPath, "utf8");
    const nextConfig = configText.replace(/version:\s*"[^"]*"/, `version: "${version}"`);
    if (nextConfig === configText) {
      throw new Error(`Could not update app.version in ${configPath}`);
    }
    writeFileSync(configPath, nextConfig);
  }

  if (current.lockfile !== version) {
    const lockText = readFileSync(lockPath, "utf8");
    writeFileSync(lockPath, patchLockfileDesktopVersion(lockText, version));
  }

  return version;
}

function resolveVersionFromCliOrEnv(): string {
  const fromArg = process.argv[2]?.trim();
  if (fromArg) return normalizeVersion(fromArg);
  const fromEnv = process.env.GITHUB_REF_NAME?.trim();
  const refType = process.env.GITHUB_REF_TYPE?.trim();
  if (fromEnv && (refType === "tag" || isReleaseTagRef(fromEnv))) {
    return normalizeVersion(fromEnv);
  }
  throw new Error(
    "Usage: bun run scripts/sync-desktop-version.ts <version|vX.Y.Z>\n  or set GITHUB_REF_NAME=vX.Y.Z on a tag ref"
  );
}

if (import.meta.main) {
  try {
    const version = syncDesktopVersion(resolveVersionFromCliOrEnv());
    console.log(`Desktop version set to ${version}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
