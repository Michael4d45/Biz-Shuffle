import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BizShuffleServer } from "@bizshuffle-bun/server-host";

export function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

export async function startTestServer(): Promise<{
  server: BizShuffleServer;
  dataDir: string;
}> {
  const dataDir = mkdtempSync(join(tmpdir(), "bizshuffle-test-"));
  const port = await reservePort();
  const server = new BizShuffleServer({ dataDir, host: "127.0.0.1", port });
  await server.start();
  return { server, dataDir };
}

export async function stopTestServer(server: BizShuffleServer, dataDir: string): Promise<void> {
  await server.stop();
  await new Promise((r) => setTimeout(r, 600));
  const { rmSync } = await import("node:fs");
  rmSync(dataDir, { recursive: true, force: true });
}
