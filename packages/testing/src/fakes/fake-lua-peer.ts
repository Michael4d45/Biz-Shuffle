import type { Socket } from "bun";
import { join } from "node:path";
import { buildMinimalBizHawkSavestate } from "@bizshuffle-bun/savestate";
import { ensureDirSync, readText, writeBytesAtomic } from "@bizshuffle-bun/client-host";

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
  // Bun.listen returns a TCP listener; avoid pulling in generic Server<> from bun types.
  private server: { stop: (closeActive?: boolean) => void; port?: number } | null = null;
  private socket: Socket | null = null;
  private buffer = "";
  private readonly commands: string[] = [];
  /** Full `CMD|…` line parts from the last received command. */
  lastCmdParts: string[] = [];
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

  static async portFromFile(portFile: string): Promise<number> {
    return Number((await readText(portFile)).trim());
  }

  /** Start a TCP listener like server.lua and return the peer + bound port. */
  static async listen(opts: FakeLuaPeerOptions): Promise<FakeLuaPeer> {
    const host = opts.host ?? "127.0.0.1";
    let boundPort = opts.port ?? 0;
    let peer: FakeLuaPeer | null = null;

    const server = Bun.listen({
      hostname: host,
      port: boundPort,
      socket: {
        open: (socket) => {
          peer?.attach(socket);
        },
        data: (socket, data) => {
          peer?.onData(socket, String(data));
        },
        close: (socket) => {
          if (peer?.socket === socket) peer.socket = null;
        },
      },
    });

    boundPort = server.port ?? boundPort;
    peer = new FakeLuaPeer(opts, boundPort);
    peer.server = server;
    return peer;
  }

  stop(): void {
    this.socket?.end();
    this.socket = null;
    this.server?.stop(true);
    this.server = null;
  }

  private attach(socket: Socket): void {
    this.socket?.end();
    this.socket = socket;
    this.buffer = "";
    socket.write("HELLO\n");
  }

  private onData(socket: Socket, chunk: string): void {
    if (this.socket !== socket) return;
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
    this.lastCmdParts = parts;

    if (cmd === "SWAP" && parts.length >= 5) {
      this.instanceId = parts[4] || parts[3] || this.instanceId;
    }

    if (cmd === "SAVE") {
      const instance = parts[4] || this.instanceId;
      this.instanceId = instance;
      const dir = join(this.opts.savesDir, "saves");
      ensureDirSync(dir);
      await writeBytesAtomic(join(dir, `${instance}.state`), MINIMAL_SAVE_BYTES);
    }

    this.socket?.write(`ACK|${id}\n`);
  }
}

export async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) return;
    await Bun.sleep(25);
  }
  throw new Error(`file not found: ${path}`);
}

export function savePath(dataDir: string, instanceId: string): string {
  return join(dataDir, "saves", `${instanceId}.state`);
}
