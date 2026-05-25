import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Prefer monorepo or staged bundle paths (desktop dev / Electrobun). */
export function desktopAdminStaticDir(): string | undefined {
  const candidates = [
    resolve(import.meta.dir, "../../../packages/server-host/priv/static"),
    resolve(import.meta.dir, "../../.static-bundle/priv/static"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return undefined;
}
