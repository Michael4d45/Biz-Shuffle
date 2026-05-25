import { copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveSource(assetCandidates: string[]): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const defaults = [
    join(here, "../../assets/server.lua"),
    join(here, "../../../assets/server.lua"),
  ];
  for (const src of [...assetCandidates, ...defaults]) {
    if (existsSync(src)) return src;
  }
  throw new Error("server.lua asset not found in bundle");
}

/** Ensure server.lua exists in dataDir (copy from package assets when bundled). */
export function ensureServerLua(dataDir: string, assetCandidates: string[] = []): string {
  const dest = join(dataDir, "server.lua");
  const src = resolveSource(assetCandidates);
  const needsCopy =
    !existsSync(dest) ||
    statSync(src).mtimeMs > statSync(dest).mtimeMs;
  if (needsCopy) {
    copyFileSync(src, dest);
  }
  return dest;
}
