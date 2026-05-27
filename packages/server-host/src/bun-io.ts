import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export function pathExists(path: string): boolean {
  return existsSync(path);
}

export function ensureDirSync(path: string): void {
  mkdirSync(path, { recursive: true });
}

export async function readText(path: string): Promise<string> {
  return Bun.file(path).text();
}

export async function writeTextAtomic(path: string, contents: string): Promise<void> {
  ensureDirSync(dirname(path));
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, contents);
  renameSync(tmp, path);
}

export async function writeBytesAtomic(path: string, data: Buffer | Uint8Array): Promise<void> {
  ensureDirSync(dirname(path));
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, data);
  renameSync(tmp, path);
}
