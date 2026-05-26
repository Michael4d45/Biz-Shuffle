/**
 * Embed Windows app icons into launcher/bun/setup exes.
 *
 * Workaround for Electrobun 1.18.1: stock build copies PNG to Resources/app.ico
 * but PE embedding is skipped when rcedit resolve fails (hardcoded D:\\a\\electrobun\\… path).
 * @see https://github.com/blackboardsh/electrobun/issues/429
 * @see https://github.com/blackboardsh/electrobun/pull/433
 *
 * Remove postBuild/postPackage hooks once a fixed Electrobun release is verified.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const desktopRoot = resolve(import.meta.dir, "..");
const iconPng = join(desktopRoot, "icon.iconset", "icon_256x256.png");

function rceditExe(): string {
  const pkg = require.resolve("rcedit/package.json");
  const dir = dirname(pkg);
  const x64 = join(dir, "bin", "rcedit-x64.exe");
  const fallback = join(dir, "bin", "rcedit.exe");
  if (existsSync(x64)) return x64;
  if (existsSync(fallback)) return fallback;
  throw new Error("rcedit binary not found — run bun install in apps/desktop");
}

async function writeIcoFromPng(pngPath: string, icoPath: string): Promise<void> {
  const pngToIco = (await import("png-to-ico")).default;
  const buf = await pngToIco(pngPath);
  writeFileSync(icoPath, new Uint8Array(buf));
}

function embedIcon(exePath: string, icoPath: string): void {
  execFileSync(rceditExe(), [exePath, "--set-icon", icoPath], {
    stdio: "pipe",
  });
}

function patchExeDir(binDir: string, icoPath: string): void {
  for (const name of readdirSync(binDir)) {
    if (!name.endsWith(".exe")) continue;
    const exe = join(binDir, name);
    try {
      embedIcon(exe, icoPath);
      console.log(`[embed-win-icons] ${name}`);
    } catch (err) {
      console.warn(
        `[embed-win-icons] skipped ${name}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

function patchSetupExes(artifactDir: string, icoPath: string): void {
  if (!existsSync(artifactDir)) return;
  for (const name of readdirSync(artifactDir)) {
    if (!name.endsWith(".exe") || !name.includes("Setup")) continue;
    const exe = join(artifactDir, name);
    try {
      embedIcon(exe, icoPath);
      console.log(`[embed-win-icons] ${name}`);
    } catch (err) {
      console.warn(
        `[embed-win-icons] skipped ${name}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function main(): Promise<void> {
  const targetOs = process.env.ELECTROBUN_OS;
  if (targetOs && targetOs !== "win") return;

  if (!existsSync(iconPng)) {
    console.error(`[embed-win-icons] missing ${iconPng} — run: bun run icons`);
    process.exit(1);
  }

  const buildDir = resolve(desktopRoot, process.env.ELECTROBUN_BUILD_DIR ?? "build");
  const env = process.env.ELECTROBUN_BUILD_ENV ?? "stable";
  const os = process.env.ELECTROBUN_OS ?? "win";
  const arch = process.env.ELECTROBUN_ARCH ?? "x64";
  const appName = process.env.ELECTROBUN_APP_NAME ?? "BizShuffle";
  const platformDir = join(buildDir, `${env}-${os}-${arch}`);
  const bundleRoot = join(platformDir, appName);
  const binDir = join(bundleRoot, "bin");

  const icoPath = join(buildDir, ".bizshuffle-app.ico");
  await writeIcoFromPng(iconPng, icoPath);

  const resourcesIco = join(bundleRoot, "Resources", "app.ico");
  if (existsSync(dirname(resourcesIco))) {
    copyFileSync(icoPath, resourcesIco);
    console.log(`[embed-win-icons] Resources/app.ico`);
  }

  if (existsSync(binDir)) {
    patchExeDir(binDir, icoPath);
  } else {
    console.warn(`[embed-win-icons] bin dir not found: ${binDir}`);
  }

  const artifactDir = process.env.ELECTROBUN_ARTIFACT_DIR
    ? resolve(desktopRoot, process.env.ELECTROBUN_ARTIFACT_DIR)
    : resolve(desktopRoot, "artifacts");
  patchSetupExes(artifactDir, icoPath);
}

main().catch((err) => {
  console.error("[embed-win-icons]", err);
  process.exit(1);
});
