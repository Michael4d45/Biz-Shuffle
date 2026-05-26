import { createServer, type Server, type Socket } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildMinimalBizHawkSavestate } from "@bizshuffle-bun/savestate";

const MINIMAL_SAVE_BYTES = Buffer.from(buildMinimalBizHawkSavestate());

export interface FakeLuaPeerOptions {
  /** Client data dir — writes saves under `{savesDir}/saves/`. */
  savesDir: string;
  /** Instance id used when handling SAVE (updated on SWAP too). */
  instanceId?: string;
  host?: string;
  /** 0 = OS-assigned port. */
  port?: number;
}

/**
 * Stand-in for BizHawk + server.lua: listens for the controller (BizhawkIpc)
 * and speaks `HELLO` / `CMD|id|COMMAND|...` / `ACK|id`.
 */
export class FakeLuaPeer {
  private server: Server | null = null;
  private socket: Socket | null = null;
  private buffer = "";
  private readonly commands: string[] = [];
  readonly port: number;
  instanceId: string;

  private constructor(
    private readonly opts: FakeLuaPeerOptions,
    port: number
  ) {
    this.port = port;
    this.instanceId = opts.instanceId ?? "test-instance";
  }

  get receivedCommands(): readonly string[] {
    return this.commands;
  }

  static portFromFile(portFile: string): number {
    return Number(readFileSync(portFile, "utf8").trim());
  }

  /** Start a TCP listener like server.lua and return the peer + bound port. */
  static async listen(opts: FakeLuaPeerOptions): Promise<FakeLuaPeer> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      let boundPort = opts.port ?? 0;

      server.on("error", reject);
      server.listen(boundPort, opts.host ?? "127.0.0.1", () => {
        const addr = server.address();
        if (typeof addr === "object" && addr) boundPort = addr.port;
        const peer = new FakeLuaPeer(opts, boundPort);
        peer.server = server;
        server.on("connection", (socket) => peer.attach(socket));
        resolve(peer);
      });
    });
  }

  stop(): void {
    this.socket?.destroy();
    this.socket = null;
    this.server?.close();
    this.server = null;
  }

  private attach(socket: Socket): void {
    this.socket?.destroy();
    this.socket = socket;
    this.buffer = "";
    socket.setEncoding("utf8");
    socket.write("HELLO\n");
    socket.on("data", (chunk) => this.onData(String(chunk)));
    socket.once("close", () => {
      if (this.socket === socket) this.socket = null;
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) void this.handleLine(line);
    }
  }

  private async handleLine(line: string): Promise<void> {
    const parts = line.split("|");
    if (parts[0] !== "CMD" || parts.length < 3) return;
    const id = parts[1]!;
    const cmd = parts[2]!;
    this.commands.push(cmd);

    if (cmd === "SWAP" && parts.length >= 5) {
      this.instanceId = parts[4] || parts[3] || this.instanceId;
    }

    if (cmd === "SAVE") {
      const dir = join(this.opts.savesDir, "saves");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${this.instanceId}.state`), MINIMAL_SAVE_BYTES);
    }

    this.socket?.write(`ACK|${id}\n`);
  }
}

export async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      readFileSync(path);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  throw new Error(`file not found: ${path}`);
}

export function savePath(dataDir: string, instanceId: string): string {
  return join(dataDir, "saves", `${instanceId}.state`);
}
