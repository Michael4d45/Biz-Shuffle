/**
 * Copy built admin SPA into .static-bundle for Electrobun copy step.
 * Run before electrobun dev/build (via preBuild hook).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const desktopRoot = resolve(import.meta.dir, "..");
const monorepoRoot = resolve(desktopRoot, "../..");
const src = join(monorepoRoot, "packages", "server-host", "priv", "static");
const dest = join(desktopRoot, ".static-bundle", "priv", "static");

if (!existsSync(join(src, "index.html"))) {
  console.error(`Admin static not built at ${src}`);
  console.error("Run from TSBunShuffle: bun run build:admin");
  process.exit(1);
}

rmSync(join(desktopRoot, ".static-bundle"), { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Staged admin static: ${src} -> ${dest}`);
