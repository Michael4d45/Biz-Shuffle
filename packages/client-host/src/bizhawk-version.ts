import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Minimum BizHawk release this BizShuffle build supports.
 * Bump when a release requires newer BizHawk APIs or Lua behavior.
 */
export const SUPPORTED_BIZHAWK_VERSION = "2.11.1";

export class BizHawkVersionError extends Error {
  readonly name = "BizHawkVersionError";

  constructor(
    readonly installedVersion: string | null,
    readonly supportedVersion: string
  ) {
    const installed = installedVersion ?? "unknown";
    super(
      `BizHawk ${installed} is installed; version ${supportedVersion} or newer is required. Update BizHawk to continue.`
    );
  }
}

/** Compare dotted version strings (e.g. 2.9 vs 2.10). */
export function compareBizHawkVersions(a: string, b: string): number {
  const pa = a
    .replace(/^v/i, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = b
    .replace(/^v/i, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

export function bizHawkNeedsUpdate(
  installed: string | null,
  supported: string = SUPPORTED_BIZHAWK_VERSION
): boolean {
  if (!installed) return false;
  return compareBizHawkVersions(installed, supported) < 0;
}

/** Infer BizHawk version from install path or version.txt beside EmuHawk.exe. */
export function detectInstalledBizHawkVersion(exePath: string): string | null {
  const normalized = exePath.replace(/\\/g, "/");
  for (const part of normalized.split("/")) {
    const fromName = part.match(/BizHawk[-_]?v?(\d+\.\d+(?:\.\d+)?)/i);
    if (fromName?.[1]) return fromName[1];
  }

  const versionFile = join(dirname(exePath), "version.txt");
  if (existsSync(versionFile)) {
    try {
      const text = readFileSync(versionFile, "utf8");
      const m = text.match(/(\d+\.\d+(?:\.\d+)?)/);
      if (m?.[1]) return m[1];
    } catch {
      /* ignore */
    }
  }

  return null;
}

export type BizHawkStatus = {
  exePath: string | null;
  installedVersion: string | null;
  supportedVersion: string;
  missing: boolean;
  needsUpdate: boolean;
};
