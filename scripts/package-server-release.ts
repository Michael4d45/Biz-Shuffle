#!/usr/bin/env bun
/**
 * Stage a Windows server release zip for GitHub Releases.
 * Requires: bun run build:admin && server-app build:release
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const version = (process.env.GITHUB_REF_NAME ?? "v0.0.0").replace(/^v/, "");
const stagingRoot = join(root, "release-staging");
const stageDir = join(stagingRoot, `bizshuffle-server-${version}-win-x64`);
const zipPath = join(stagingRoot, `bizshuffle-server-${version}-win-x64.zip`);

const serverExe = join(root, "apps/server/dist/bizshuffle-server.exe");
const adminStatic = join(root, "packages/server-host/priv/static");
const serverLua = join(root, "assets/server.lua");

if (!existsSync(serverExe)) {
  console.error(
    `Missing ${serverExe} — run: bun run --filter @bizshuffle-bun/server-app build:release`
  );
  process.exit(1);
}
if (!existsSync(join(adminStatic, "index.html"))) {
  console.error(`Missing admin static — run: bun run build:admin`);
  process.exit(1);
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "priv"), { recursive: true });
cpSync(serverExe, join(stageDir, "bizshuffle-server.exe"));
cpSync(adminStatic, join(stageDir, "priv/static"), { recursive: true });
if (existsSync(serverLua)) {
  cpSync(serverLua, join(stageDir, "server.lua"));
}

rmSync(zipPath, { force: true });
const zipCmd =
  process.platform === "win32"
    ? [
        "powershell",
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${stageDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
      ]
    : ["zip", "-r", zipPath, "."];

const proc = Bun.spawn(zipCmd, {
  cwd: process.platform === "win32" ? undefined : stageDir,
  stdout: "inherit",
  stderr: "inherit",
});
const code = await proc.exited;
if (code !== 0) {
  console.error("Failed to create server release zip");
  process.exit(code ?? 1);
}

console.log(`Created ${zipPath}`);
