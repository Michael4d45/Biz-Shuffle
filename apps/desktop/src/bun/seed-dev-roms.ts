import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findDataRomsDir } from "@bizshuffle-bun/server-host";
import { desktopLog } from "./log.js";

/** Dev convenience: copy repo `data/roms` (or GOShuffle dist) into the user data dir when empty. */
export function seedRomsFromRepoIfEmpty(dataDir: string): void {
  const dest = join(dataDir, "roms");
  mkdirSync(dest, { recursive: true });
  const existing = readdirSync(dest).filter((n) => n.toLowerCase().endsWith(".zip"));
  if (existing.length > 0) return;

  const src = findDataRomsDir();
  if (!src) {
    desktopLog("bizshuffle-bun", "seedRoms: no source data/roms directory found");
    return;
  }

  let copied = 0;
  for (const name of readdirSync(src)) {
    if (!name.toLowerCase().endsWith(".zip")) continue;
    copyFileSync(join(src, name), join(dest, name));
    copied++;
  }
  if (copied > 0) {
    desktopLog("bizshuffle-bun", `seeded ${copied} ROM(s) from ${src} -> ${dest}`);
  }
}
