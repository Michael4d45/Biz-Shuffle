#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ClientRuntime } from "@bizshuffle-bun/client-host";

function parseArgs(argv: string[]): {
  join: boolean;
  name: string;
  server: string;
  dataDir: string;
} {
  let join = false;
  let name = "";
  let server = "http://127.0.0.1:8080";
  let dataDir = resolve(process.cwd(), "data");

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--join") join = true;
    else if (a === "--name" && argv[i + 1]) name = argv[++i]!;
    else if (a === "--server" && argv[i + 1]) server = argv[++i]!;
    else if (a === "--data-dir" && argv[i + 1]) dataDir = resolve(argv[++i]!);
  }

  if (!join) {
    console.error("Usage: bizshuffle-client --join --name <player> [--server <url>] [--data-dir <path>]");
    process.exit(1);
  }
  if (!name) {
    console.error("--name is required");
    process.exit(1);
  }

  return { join, name, server, dataDir };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.dataDir, { recursive: true });

  const runtime = new ClientRuntime({
    dataDir: args.dataDir,
    serverUrl: args.server,
    playerName: args.name,
  });

  const shutdown = async () => {
    await runtime.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await runtime.connect({
    dataDir: args.dataDir,
    serverUrl: args.server,
    playerName: args.name,
  });
  console.log(`Connected as ${args.name} to ${args.server}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
