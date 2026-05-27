import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const adminSrc = join(repoRoot, "packages/admin-ui/src");

const FORBIDDEN = [
  /@bizshuffle-bun\/server-host\b/,
  /@bizshuffle\/server\b/,
  /from\s+['"][^'"]*packages\/server/,
  /from\s+['"][^'"]*\/server\/src\//,
  /BizShuffleServer/,
  /startBizShuffleServe/,
  /handleHttpRequest/,
  /ServerSession/,
];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...collectTsFiles(p));
    else if (/\.(tsx?|jsx?)$/.test(name.name)) out.push(p);
  }
  return out;
}

describe("admin package isolation", () => {
  it("must not import @bizshuffle-bun/server-host or server internals", () => {
    const files = collectTsFiles(adminSrc);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        expect(src, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
