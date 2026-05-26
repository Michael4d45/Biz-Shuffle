import { mkdirSync, readdirSync, existsSync, rmSync, createWriteStream } from "node:fs";
import { execSync } from "node:child_process";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { ensureDefaults, loadConfig, saveConfig } from "./config.js";
import {
  BizHawkVersionError,
  SUPPORTED_BIZHAWK_VERSION,
  bizHawkNeedsUpdate,
  detectInstalledBizHawkVersion,
  type BizHawkStatus,
} from "./bizhawk-version.js";

function fallbackBizHawkDownloadUrl(version: string): string {
  const tag = version.replace(/^v/, "");
  const suffix = process.platform === "win32" ? "win-x64" : "linux-x64";
  return `https://github.com/TASEmulators/BizHawk/releases/download/${tag}/BizHawk-${tag}-${suffix}.zip`;
}

type GhRelease = { tag_name: string; assets: { name: string; browser_download_url: string }[] };

/** Managed BizHawk install root: `{dataDir}/BizHawk`. */
export function bizHawkInstallDir(dataDir: string): string {
  return join(dataDir, "BizHawk");
}

export function isManagedBizHawkPath(dataDir: string, exePath: string): boolean {
  const root = resolve(bizHawkInstallDir(dataDir));
  const normalized = resolve(exePath);
  if (normalized === root) return true;
  const rel = relative(root, normalized);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function clearStaleBizhawkConfig(dataDir: string, cfg: Record<string, string>): void {
  const path = cfg.bizhawk_path?.trim();
  if (!path) return;
  if (!isManagedBizHawkPath(dataDir, path)) {
    delete cfg.bizhawk_path;
    saveConfig(dataDir, cfg);
  }
}

/** Locate EmuHawk.exe only under `{dataDir}/BizHawk` (no system-wide search). */
export function resolveEmuHawkPath(dataDir: string): string {
  const cfg = loadConfig(dataDir);
  ensureDefaults(cfg);
  clearStaleBizhawkConfig(dataDir, cfg);

  const installDir = bizHawkInstallDir(dataDir);
  const exe = findEmuHawkInDir(installDir);
  if (!exe) {
    throw new Error(`BizHawk (EmuHawk.exe) not found under ${installDir}`);
  }
  return persistBizhawkPath(dataDir, cfg, exe);
}

/** Version from path/version.txt, or supported version when under managed install. */
export function resolveInstalledBizHawkVersion(dataDir: string, exePath: string): string | null {
  const detected = detectInstalledBizHawkVersion(exePath);
  if (detected) return detected;
  if (isManagedBizHawkPath(dataDir, exePath)) {
    return SUPPORTED_BIZHAWK_VERSION;
  }
  return null;
}

function findEmuHawkInDir(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const direct = join(dir, "EmuHawk.exe");
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = join(dir, entry.name, "EmuHawk.exe");
    if (existsSync(nested)) return nested;
  }
  return null;
}

function persistBizhawkPath(dataDir: string, cfg: Record<string, string>, absPath: string): string {
  if (cfg.bizhawk_path !== absPath) {
    cfg.bizhawk_path = absPath;
    saveConfig(dataDir, cfg);
  }
  return absPath;
}

/** Resolve download URL for a specific BizHawk release tag (defaults to supported version). */
export async function getBizHawkDownloadUrl(
  version: string = SUPPORTED_BIZHAWK_VERSION
): Promise<string> {
  const tag = version.replace(/^v/, "");
  try {
    const res = await fetch(
      `https://api.github.com/repos/TASEmulators/BizHawk/releases/tags/${encodeURIComponent(tag)}`,
      { headers: { Accept: "application/vnd.github+json", "User-Agent": "bizshuffle-bun" } }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const release = (await res.json()) as GhRelease;
    const suffix = process.platform === "win32" ? "win-x64" : "linux-x64";
    const patterns = [`BizHawk-${tag}-${suffix}.zip`, `BizHawk-${release.tag_name}-${suffix}.zip`];
    for (const pattern of patterns) {
      const asset = release.assets.find((a) => a.name === pattern);
      if (asset) return asset.browser_download_url;
    }
    const loose = release.assets.find((a) => a.name.includes(suffix) && a.name.endsWith(".zip"));
    if (loose) return loose.browser_download_url;
  } catch {
    /* fallback below */
  }
  return fallbackBizHawkDownloadUrl(tag);
}

export type BizHawkProgress = (msg: string, percent?: number) => void;

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: BizHawkProgress
): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: ${url} (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let done = 0;
  const reader = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream);
  const out = createWriteStream(dest);
  reader.on("data", (chunk: Buffer | string) => {
    done += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    if (total > 0 && onProgress) {
      const pct = Math.min(99, Math.round((done / total) * 100));
      onProgress(`Downloading BizHawk… ${pct}%`, pct);
    }
  });
  await pipeline(reader, out);
  onProgress?.("Download complete", 100);
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    const cmd = `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
    execSync(`powershell -NoProfile -Command "${cmd}"`, {
      stdio: "inherit",
      windowsHide: true,
    });
    return;
  }
  execSync(`unzip -o -q ${JSON.stringify(zipPath)} -d ${JSON.stringify(destDir)}`, {
    stdio: "inherit",
  });
}

/** Download and extract BizHawk into installDir. */
export async function installBizHawk(
  installDir: string,
  progress?: BizHawkProgress,
  version: string = SUPPORTED_BIZHAWK_VERSION
): Promise<string> {
  const report = progress ?? (() => {});
  mkdirSync(installDir, { recursive: true });
  const url = await getBizHawkDownloadUrl(version);
  const archivePath = join(installDir, basename(new URL(url).pathname) || "BizHawk.zip");

  report("Downloading BizHawk…", 0);
  await downloadFile(url, archivePath, report);

  report("Extracting BizHawk…", undefined);
  await extractZip(archivePath, installDir);
  try {
    rmSync(archivePath, { force: true });
  } catch {
    /* ignore */
  }

  const exe = findEmuHawkInDir(installDir);
  if (!exe) {
    throw new Error(`BizHawk installed but EmuHawk.exe not found under ${installDir}`);
  }
  report(`BizHawk ${version} installation complete`);
  return exe;
}

/** Report whether installed BizHawk meets this build's supported version. */
export function getBizHawkStatus(dataDir: string): BizHawkStatus {
  try {
    const exePath = resolveEmuHawkPath(dataDir);
    const installedVersion = resolveInstalledBizHawkVersion(dataDir, exePath);
    return {
      exePath,
      installedVersion,
      supportedVersion: SUPPORTED_BIZHAWK_VERSION,
      missing: false,
      needsUpdate: bizHawkNeedsUpdate(installedVersion, SUPPORTED_BIZHAWK_VERSION),
    };
  } catch {
    return {
      exePath: null,
      installedVersion: null,
      supportedVersion: SUPPORTED_BIZHAWK_VERSION,
      missing: true,
      needsUpdate: false,
    };
  }
}

/** Reinstall BizHawk to the supported release under dataDir/BizHawk. */
export async function upgradeBizHawk(dataDir: string, progress?: BizHawkProgress): Promise<string> {
  const report = progress ?? (() => {});
  const cfg = loadConfig(dataDir);
  ensureDefaults(cfg);
  clearStaleBizhawkConfig(dataDir, cfg);
  const installDir = bizHawkInstallDir(dataDir);
  if (existsSync(installDir)) {
    report("Removing previous BizHawk install…");
    rmSync(installDir, { recursive: true, force: true });
  }
  const exe = await installBizHawk(installDir, report, SUPPORTED_BIZHAWK_VERSION);
  return persistBizhawkPath(dataDir, cfg, exe);
}

function assertBizHawkVersionSupported(dataDir: string, exePath: string): void {
  const installed = resolveInstalledBizHawkVersion(dataDir, exePath);
  if (bizHawkNeedsUpdate(installed, SUPPORTED_BIZHAWK_VERSION)) {
    throw new BizHawkVersionError(installed, SUPPORTED_BIZHAWK_VERSION);
  }
}

/**
 * Find or install BizHawk before join/play.
 * Desktop: auto-installs when missing (no stdin prompt). CLI may prompt separately.
 */
export async function ensureBizHawkReady(
  dataDir: string,
  opts?: { progress?: BizHawkProgress; allowInstall?: boolean; allowOutdated?: boolean }
): Promise<string> {
  const progress = opts?.progress ?? (() => {});
  const allowInstall = opts?.allowInstall ?? true;
  const allowOutdated = opts?.allowOutdated ?? false;

  try {
    const existing = resolveEmuHawkPath(dataDir);
    if (!allowOutdated) {
      assertBizHawkVersionSupported(dataDir, existing);
    }
    progress(`BizHawk found: ${existing}`);
    return existing;
  } catch (err) {
    if (err instanceof BizHawkVersionError) throw err;
    /* install below */
  }

  if (!allowInstall) {
    throw new Error(
      "BizHawk is required. Run the BizShuffle installer or set bizhawk_path in config.json."
    );
  }

  const installDir = bizHawkInstallDir(dataDir);
  progress("BizHawk not found — installing…");
  const exe = await installBizHawk(installDir, progress);
  const cfg = loadConfig(dataDir);
  ensureDefaults(cfg);
  return persistBizhawkPath(dataDir, cfg, exe);
}
