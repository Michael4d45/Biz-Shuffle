import { mkdirSync, readdirSync, existsSync, rmSync, createWriteStream } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { ensureDefaults, loadConfig, saveConfig } from "./config.js";

const FALLBACK_WIN_URL =
  "https://github.com/TASEmulators/BizHawk/releases/download/2.10/BizHawk-2.10-win-x64.zip";

type GhRelease = { tag_name: string; assets: { name: string; browser_download_url: string }[] };

function tryPath(candidate: string, tried: string[]): string | null {
  const p = resolve(candidate);
  tried.push(p);
  return existsSync(p) ? p : null;
}

/** Locate existing EmuHawk.exe without downloading. */
export function resolveEmuHawkPath(dataDir: string): string {
  const tried: string[] = [];
  const cfg = loadConfig(dataDir);
  ensureDefaults(cfg);

  const candidates: string[] = [];
  if (process.env.BIZSHUFFLE_EMUHAWK_PATH) candidates.push(process.env.BIZSHUFFLE_EMUHAWK_PATH);
  if (process.env.BIZHAWK_PATH) candidates.push(process.env.BIZHAWK_PATH);
  if (cfg.bizhawk_path) candidates.push(cfg.bizhawk_path);

  const installDir = join(dataDir, "BizHawk");
  const roots = [
    installDir,
    dataDir,
    join(homedir(), "BizShuffle", "BizHawk"),
    "C:\\Program Files\\BizHawk",
  ];
  for (const root of roots) {
    candidates.push(join(root, "EmuHawk.exe"));
    const nested = findEmuHawkInDir(root);
    if (nested) candidates.push(nested);
  }

  const projectsDir = join(homedir(), "Projects");
  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /bizhawk/i.test(entry.name)) {
        candidates.push(join(projectsDir, entry.name, "EmuHawk.exe"));
      }
    }
  }

  if (process.platform === "win32") {
    try {
      const out = execSync("where EmuHawk", {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of out.split(/\r?\n/)) {
        const t = line.trim();
        if (t) candidates.push(t);
      }
    } catch {
      /* not on PATH */
    }
  }

  for (const raw of candidates) {
    if (!raw?.trim()) continue;
    const p = raw.trim();
    if (!isAbsolute(p)) {
      const hit = tryPath(join(dataDir, p), tried);
      if (hit) return persistBizhawkPath(dataDir, cfg, hit);
    }
    const hit = tryPath(p, tried);
    if (hit) return persistBizhawkPath(dataDir, cfg, hit);
  }

  throw new Error(
    `BizHawk (EmuHawk.exe) not found under ${dataDir}. Will install to ${installDir} if allowed.`
  );
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

export async function getBizHawkDownloadUrl(): Promise<string> {
  try {
    const res = await fetch("https://api.github.com/repos/TASEmulators/BizHawk/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "bizshuffle-bun" },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const release = (await res.json()) as GhRelease;
    const suffix = process.platform === "win32" ? "win-x64" : "linux-x64";
    const tag = release.tag_name.replace(/^v/, "");
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
  return FALLBACK_WIN_URL;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: ${url} (${res.status})`);
  await pipeline(
    Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream),
    createWriteStream(dest)
  );
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
  progress?: (msg: string) => void
): Promise<string> {
  const report = progress ?? (() => {});
  mkdirSync(installDir, { recursive: true });
  const url = await getBizHawkDownloadUrl();
  const archivePath = join(installDir, basename(new URL(url).pathname) || "BizHawk.zip");

  report("Downloading BizHawk…");
  await downloadFile(url, archivePath);

  report("Extracting BizHawk…");
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
  report("BizHawk installation complete");
  return exe;
}

/**
 * Find or install BizHawk before join/play.
 * Desktop: auto-installs when missing (no stdin prompt). CLI may prompt separately.
 */
export async function ensureBizHawkReady(
  dataDir: string,
  opts?: { progress?: (msg: string) => void; allowInstall?: boolean }
): Promise<string> {
  const progress = opts?.progress ?? (() => {});
  const allowInstall = opts?.allowInstall ?? true;

  try {
    const existing = resolveEmuHawkPath(dataDir);
    progress(`BizHawk found: ${existing}`);
    return existing;
  } catch {
    /* install below */
  }

  if (!allowInstall) {
    throw new Error(
      "BizHawk is required. Run the BizShuffle installer or set bizhawk_path in config.json."
    );
  }

  const installDir = join(dataDir, "BizHawk");
  progress("BizHawk not found — installing…");
  const exe = await installBizHawk(installDir, progress);
  const cfg = loadConfig(dataDir);
  ensureDefaults(cfg);
  return persistBizhawkPath(dataDir, cfg, exe);
}
