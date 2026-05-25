import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Open a directory in the OS file manager (works when the server runs in the desktop main process). */
export function openPathInFileManager(targetPath: string): void {
  const path = resolve(targetPath);
  mkdirSync(path, { recursive: true });
  switch (process.platform) {
    case "win32":
      spawn("explorer.exe", [path], { detached: true, stdio: "ignore" }).unref();
      break;
    case "darwin":
      spawn("open", [path], { detached: true, stdio: "ignore" }).unref();
      break;
    default:
      spawn("xdg-open", [path], { detached: true, stdio: "ignore" }).unref();
      break;
  }
}
