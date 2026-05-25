import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("domain package has no I/O imports", () => {
  const domainSrc = join(import.meta.dirname, "..", "..", "..", "domain", "src");

  it("scans all domain source files", () => {
    const forbidden = [/from ["']node:fs["']/, /from ["']bun:fs["']/, /from ["']node:net["']/];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) {
          const content = readFileSync(full, "utf8");
          for (const pat of forbidden) {
            expect(pat.test(content), `${full} must not import I/O`).toBe(false);
          }
        }
      }
    };
    walk(domainSrc);
  });
});
