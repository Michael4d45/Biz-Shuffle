/**
 * Embed Windows app icons into launcher/bun/setup exes.
 *
 * Workaround for Electrobun 1.18.1: stock build copies PNG to Resources/app.ico
 * but PE embedding is skipped when rcedit resolve fails (hardcoded D:\\a\\electrobun\\… path).
 * @see https://github.com/blackboardsh/electrobun/issues/429
 * @see https://github.com/blackboardsh/electrobun/pull/433
 *
 * ELECTROBUN_BUILD_DIR is already `build/{env}-win-x64` — do not append the platform prefix again.
 * The installed app is extracted from Resources/*.tar.zst; postWrap patches that archive too.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

function zstdExe(): string {
  const candidate = join(desktopRoot, "node_modules", "electrobun", "dist-win-x64", "zig-zstd.exe");
  if (existsSync(candidate)) return candidate;
  throw new Error(`zig-zstd not found at ${candidate}`);
}

function systemTar(): string {
  const winTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  return existsSync(winTar) ? winTar : "tar";
}

async function writeIcoFromPng(pngPath: string, icoPath: string): Promise<void> {
  const pngToIco = (await import("png-to-ico")).default;
  const buf = await pngToIco(pngPath);
  writeFileSync(icoPath, new Uint8Array(buf));
}

function embedIcon(exePath: string, icoPath: string): void {
  execFileSync(rceditExe(), [exePath, "--set-icon", icoPath], { stdio: "pipe" });
}

function patchExeDir(binDir: string, icoPath: string): void {
  if (!existsSync(binDir)) return;
  for (const name of readdirSync(binDir)) {
    if (!name.endsWith(".exe")) continue;
    const exe = join(binDir, name);
    try {
      embedIcon(exe, icoPath);
      console.log(`[embed-win-icons] ${exe}`);
    } catch (err) {
      console.warn(`[embed-win-icons] skipped ${name}:`, err instanceof Error ? err.message : err);
    }
  }
}

function patchBundleRoot(bundleRoot: string, icoPath: string): void {
  if (!existsSync(bundleRoot)) return;
  patchExeDir(join(bundleRoot, "bin"), icoPath);
  const resourcesIco = join(bundleRoot, "Resources", "app.ico");
  if (existsSync(dirname(resourcesIco))) {
    copyFileSync(icoPath, resourcesIco);
    console.log(`[embed-win-icons] ${resourcesIco}`);
  }
}

/** Patch launcher/bun inside the tar.zst that Setup extracts on install. */
function patchPayloadTarZst(resourcesDir: string, appName: string, icoPath: string): void {
  if (!existsSync(resourcesDir)) return;
  const tarZst = readdirSync(resourcesDir).find((f) => f.endsWith(".tar.zst"));
  if (!tarZst) return;

  const zstPath = join(resourcesDir, tarZst);
  const tarPath = join(resourcesDir, tarZst.replace(/\.zst$/, ""));
  const staging = join(resourcesDir, ".icon-patch-staging");

  try {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });

    execFileSync(zstdExe(), ["decompress", "-f", zstPath, "-o", tarPath], { stdio: "pipe" });
    execFileSync(systemTar(), ["-xf", tarPath, "-C", staging], { stdio: "pipe" });

    const payloadRoot = join(staging, appName);
    patchBundleRoot(payloadRoot, icoPath);
    if (!existsSync(join(payloadRoot, "bin", "launcher.exe"))) {
      // Fallback: find any bin/launcher.exe under staging
      for (const entry of readdirSync(staging, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(staging, entry.name);
        if (existsSync(join(candidate, "bin", "launcher.exe"))) {
          patchBundleRoot(candidate, icoPath);
          break;
        }
      }
    }

    if (existsSync(tarPath)) rmSync(tarPath, { force: true });
    execFileSync(systemTar(), ["-cf", tarPath, "-C", staging, appName], { stdio: "pipe" });
    rmSync(zstPath, { force: true });
    execFileSync(zstdExe(), ["compress", "-f", tarPath, "-o", zstPath], { stdio: "pipe" });
    if (existsSync(tarPath)) rmSync(tarPath, { force: true });
    console.log(`[embed-win-icons] repacked ${tarZst}`);
  } catch (err) {
    console.warn(
      `[embed-win-icons] failed to patch ${tarZst}:`,
      err instanceof Error ? err.message : err
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function patchSetupExes(artifactDir: string, icoPath: string): void {
  if (!existsSync(artifactDir)) return;
  for (const name of readdirSync(artifactDir)) {
    if (!name.endsWith(".exe") || !name.includes("Setup")) continue;
    const exe = join(artifactDir, name);
    try {
      embedIcon(exe, icoPath);
      console.log(`[embed-win-icons] ${exe}`);
    } catch (err) {
      console.warn(`[embed-win-icons] skipped ${name}:`, err instanceof Error ? err.message : err);
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

  const env = process.env.ELECTROBUN_BUILD_ENV ?? "stable";
  const os = process.env.ELECTROBUN_OS ?? "win";
  const arch = process.env.ELECTROBUN_ARCH ?? "x64";
  const appName = process.env.ELECTROBUN_APP_NAME ?? "BizShuffle";
  const platformSuffix = `${env}-${os}-${arch}`;

  const buildDir = process.env.ELECTROBUN_BUILD_DIR
    ? resolve(process.env.ELECTROBUN_BUILD_DIR)
    : resolve(desktopRoot, "build", platformSuffix);

  const bundleRoot = join(buildDir, appName);
  const icoPath = join(buildDir, ".bizshuffle-app.ico");
  await writeIcoFromPng(iconPng, icoPath);

  if (existsSync(bundleRoot)) {
    patchBundleRoot(bundleRoot, icoPath);
  } else {
    console.warn(`[embed-win-icons] bundle not found: ${bundleRoot}`);
  }

  const wrapperPath = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
  if (wrapperPath) {
    const wrapperRoot = resolve(wrapperPath);
    patchExeDir(join(wrapperRoot, "bin"), icoPath);
    patchPayloadTarZst(join(wrapperRoot, "Resources"), appName, icoPath);
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
