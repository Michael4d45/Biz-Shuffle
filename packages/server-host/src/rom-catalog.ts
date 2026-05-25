import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BizShuffleServer } from "./server.js";

export function listRoms(dataDir: string): string[] {
  const romsDir = join(dataDir, "roms");
  if (!existsSync(romsDir)) return [];
  const files: string[] = [];
  const walk = (dir: string, base: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = join(base, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else files.push(rel.replace(/\\/g, "/"));
    }
  };
  walk(romsDir, "");
  return files;
}

/**
 * Merge ROM files from ./roms into the session catalog and enable them for sync mode.
 * Returns true when catalog state was updated.
 */
export async function syncCatalogFromRoms(server: BizShuffleServer): Promise<boolean> {
  const files = listRoms(server.dataDir);
  if (files.length === 0) return false;

  let merged = false;
  server.updateStateAndPersist((st) => {
    const main = [...(st.main_games ?? [])];
    for (const f of files) {
      if (!main.some((g) => g.file === f || (g.extra_files ?? []).includes(f))) {
        main.push({ file: f });
        merged = true;
      }
    }
    st.main_games = main;
  });

  const st = server.snapshotState();
  const enabled = new Set(st.games ?? []);
  const needsSetup =
    merged ||
    enabled.size === 0 ||
    files.some((f) => !enabled.has(f)) ||
    (st.main_games?.length ?? 0) === 0;

  if (!needsSetup) return false;

  await server.getGameModeHandler().setupState();
  return true;
}

/** Back-compat alias for {@link syncCatalogFromRoms}. */
export async function seedCatalogFromRomsIfEmpty(server: BizShuffleServer): Promise<boolean> {
  return syncCatalogFromRoms(server);
}
