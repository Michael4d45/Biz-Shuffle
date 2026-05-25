/**
 * Launch Electrobun dev briefly, wait for shell lifecycle logs, kill, report.
 * Run: bun run smoke (from apps/desktop)
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { BizShuffleServer } from "@bizshuffle-bun/server-host";

const DESKTOP_DIR = join(import.meta.dir, "..");
const DESKTOP_LOG = join(homedir(), "BizShuffle", "logs", "desktop-smoke.log");
const STDOUT_LOG = join(DESKTOP_DIR, "build", "smoke-stdout.log");
const WAIT_MS = 12_000;

const REQUIRED_MARKERS = [
  "[bizshuffle-bun] desktop main starting",
  "[bizshuffle-bun] shell window created",
  "loadViewsFile: Attempting flat file read:",
  "shell/index.js",
  "[bizshuffle-shell] Electroview constructed",
  "[bizshuffle-shell] render:welcome done — host button=yes",
];

function readText(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function truncateLog(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  if (existsSync(path)) unlinkSync(path);
  writeFileSync(path, "", "utf8");
}

async function verifyEmbeddedAdminServes(): Promise<void> {
  const staticDir = join(DESKTOP_DIR, ".static-bundle", "priv", "static");
  const index = join(staticDir, "index.html");
  if (!existsSync(index)) {
    throw new Error(`Staged admin static missing at ${index} (run stage-admin-static)`);
  }
  const dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-smoke-"));
  const server = new BizShuffleServer({
    dataDir,
    host: "127.0.0.1",
    port: 0,
    staticDir,
  });
  await server.start();
  try {
    const res = await fetch(`${server.url}/`);
    if (res.status !== 200) {
      throw new Error(`Embedded GET / returned ${res.status}`);
    }
    const html = await res.text();
    if (!html.includes("/assets/")) {
      throw new Error("Embedded GET / missing /assets/ references");
    }
    console.log("Desktop smoke: embedded server GET / OK");
  } finally {
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

console.log("Desktop smoke: verifying embedded admin static…");
await verifyEmbeddedAdminServes();

console.log("Desktop smoke: clearing prior logs…");
truncateLog(DESKTOP_LOG);
truncateLog(STDOUT_LOG);

console.log(`Desktop smoke: launching electrobun dev (${WAIT_MS}ms)…`);
const child = spawn("bunx", ["electrobun", "dev"], {
  cwd: DESKTOP_DIR,
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
child.stdout?.on("data", (chunk: Buffer) => {
  const text = chunk.toString();
  stdout += text;
  process.stdout.write(text);
});
child.stderr?.on("data", (chunk: Buffer) => {
  const text = chunk.toString();
  stdout += text;
  process.stderr.write(text);
});

await new Promise<void>((resolve) => {
  const timer = setTimeout(() => {
    console.log("\nDesktop smoke: stopping process…");
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: true });
    } else {
      child.kill("SIGTERM");
    }
    setTimeout(resolve, 2000);
  }, WAIT_MS);
  child.on("exit", () => {
    clearTimeout(timer);
    resolve();
  });
});

writeFileSync(STDOUT_LOG, stdout, "utf8");

const combined = `${readText(DESKTOP_LOG)}\n${stdout}`;
const missing = REQUIRED_MARKERS.filter((m) => !combined.includes(m));

console.log("\n--- Desktop smoke report ---");
console.log(`Log file: ${DESKTOP_LOG}`);
console.log(`Stdout capture: ${STDOUT_LOG}`);
for (const m of REQUIRED_MARKERS) {
  console.log(`  ${combined.includes(m) ? "OK" : "MISSING"} ${m}`);
}

if (missing.length > 0) {
  console.error(`\nSmoke FAILED — missing ${missing.length} marker(s).`);
  console.error("Last 40 lines of combined output:\n");
  console.error(combined.split("\n").slice(-40).join("\n"));
  process.exit(1);
}

console.log("\nSmoke PASSED — shell script loaded and welcome UI rendered.");
process.exit(0);
