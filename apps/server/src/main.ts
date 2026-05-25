#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { BizShuffleServer } from "@bizshuffle-bun/server-host";

function parseArgs(argv: string[]): { dataDir: string; host: string; port: number } {
  let dataDir = resolve(process.cwd(), "data");
  let host = "0.0.0.0";
  let port = 8080;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data-dir" && argv[i + 1]) dataDir = resolve(argv[++i]!);
    else if (a === "--host" && argv[i + 1]) host = argv[++i]!;
    else if (a === "--port" && argv[i + 1]) port = Number.parseInt(argv[++i]!, 10);
  }

  return { dataDir, host, port };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.dataDir, { recursive: true });

  const server = new BizShuffleServer({
    dataDir: args.dataDir,
    host: args.host,
    port: args.port,
  });

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await server.start();
  console.log(`BizShuffle server listening at ${server.url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
