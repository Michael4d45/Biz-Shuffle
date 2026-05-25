import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Walk upward looking for `data/roms` or the monorepo root. */
export function findDataRomsDir(startDir = dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 12; i++) {
    const roms = join(dir, "data", "roms");
    if (existsSync(roms)) return roms;

    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "bizshuffle-bun-monorepo") {
          const monorepoRoms = join(dir, "data", "roms");
          if (existsSync(monorepoRoms)) return monorepoRoms;
        }
      } catch {
        /* ignore */
      }
    }

    const goshuffleRoms = join(dir, "GOShuffle", "dist", "server", "roms");
    if (existsSync(goshuffleRoms)) return goshuffleRoms;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
