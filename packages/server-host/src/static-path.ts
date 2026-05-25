import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function assertHasIndexHtml(dir: string): void {
  const index = join(dir, "index.html");
  if (!existsSync(index)) {
    throw new Error(`Admin static missing: ${index} (run bun run build:admin)`);
  }
}

/** Resolve admin SPA directory (packages/server-host/priv/static). */
export function resolveAdminStaticDir(opts?: {
  explicit?: string;
  /** Module URL of the caller (e.g. server-host when bundled into desktop). */
  moduleUrl?: string;
}): string {
  const explicit = opts?.explicit ?? process.env.BIZSHUFFLE_STATIC_DIR;
  if (explicit) {
    const dir = resolve(explicit);
    assertHasIndexHtml(dir);
    return dir;
  }

  const tried: string[] = [];
  const moduleUrl = opts?.moduleUrl ?? import.meta.url;
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const fromModule = join(resolve(moduleDir, ".."), "priv", "static");
  tried.push(fromModule);
  if (existsSync(join(fromModule, "index.html"))) return fromModule;

  let dir = moduleDir;
  for (let i = 0; i < 10; i++) {
    for (const rel of [
      join("packages", "server-host", "priv", "static"),
      join("server-host", "priv", "static"),
    ]) {
      const candidate = join(dir, rel);
      tried.push(candidate);
      if (existsSync(join(candidate, "index.html"))) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Admin static files not found. Run \`bun run build:admin\` from TSBunShuffle, or set BIZSHUFFLE_STATIC_DIR.\nTried:\n${tried.map((p) => `  - ${p}`).join("\n")}`
  );
}
