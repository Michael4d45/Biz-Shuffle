import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const adminIndex = join(repoRoot, "packages", "server-host", "priv", "static", "index.html");
const desktopStageScript = join(repoRoot, "apps", "desktop", "scripts", "stage-admin-static.ts");

describe("admin static build artifacts", () => {
  it("server-host/priv/static/index.html exists (bun run build:admin)", () => {
    expect(existsSync(adminIndex), `Missing ${adminIndex} — run: bun run build:admin`).toBe(true);
  });

  it("desktop stage script exists for Electrobun copy", () => {
    expect(existsSync(desktopStageScript)).toBe(true);
  });
});
