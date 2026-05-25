import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_DIR = join(homedir(), "BizShuffle", "logs");
export const DESKTOP_LOG_FILE = join(LOG_DIR, "desktop-smoke.log");

export function desktopLog(source: string, msg: string): void {
  mkdirSync(LOG_DIR, { recursive: true });
  const line = `${new Date().toISOString()} [${source}] ${msg}`;
  console.log(line);
  appendFileSync(DESKTOP_LOG_FILE, `${line}\n`, "utf8");
}
