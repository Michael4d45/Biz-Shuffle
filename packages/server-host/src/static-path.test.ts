import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "bun:test";
import { resolveAdminStaticDir } from "./static-path.js";

describe("resolveAdminStaticDir", () => {
  it("uses explicit staticDir when index.html exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "bizshuffle-static-"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    expect(resolveAdminStaticDir({ explicit: dir })).toBe(dir);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when bundled layout has no priv/static", () => {
    const appDir = mkdtempSync(join(tmpdir(), "bizshuffle-bundle-"));
    const fakeModule = join(appDir, "bun", "main.js");
    mkdirSync(join(appDir, "bun"), { recursive: true });
    writeFileSync(fakeModule, "// bundled");
    expect(() =>
      resolveAdminStaticDir({ moduleUrl: pathToFileURL(fakeModule).href })
    ).toThrow(/Admin static files not found/);
    rmSync(appDir, { recursive: true, force: true });
  });

  it("resolves monorepo server-host/priv/static from repo", () => {
    const dir = resolveAdminStaticDir({ moduleUrl: import.meta.url });
    expect(dir.replace(/\\/g, "/")).toContain("server-host/priv/static");
  });
});
