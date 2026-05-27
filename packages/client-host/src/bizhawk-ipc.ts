import { writeFileSync } from "node:fs";
import type { Socket } from "bun";
import { IPC_TIMEOUT_MS, luaReconnectDelayMs } from "@bizshuffle-bun/protocol";
import { readText } from "./bun-io.js";

const MSG_ACK = "ACK";
const MSG_NACK = "NACK";
const MSG_HELLO = "HELLO";

export type BizhawkMessageStyle = {
  duration?: number;
  x?: number;
  y?: number;
  fontsize?: number;
  fg?: string;
  bg?: string;
};

const DEFAULT_MESSAGE_STYLE: Required<BizhawkMessageStyle> = {
  duration: 3,
  x: 10,
  y: 10,
  fontsize: 12,
  fg: "#FFFFFF",
  bg: "#000000",
};

export interface BizhawkIpcOptions {
  host?: string;
  /** Fixed port to dial (Lua listens here). */
  port?: number;
  /** Path to `lua_server_port.txt` (read on start). */
  portFile?: string;
  timeoutMs?: number;
  /** Called when Lua sends HELLO and IPC becomes ready. */
  onReady?: () => void;
}

type Pending = { id: string; resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };

/** Find a free TCP port starting at 55355 (default Lua IPC port). */
export async function reserveLuaPort(host = "127.0.0.1", start = 55355): Promise<number> {
  for (let port = start; port < 65535; port++) {
    try {
      const server = Bun.listen({
        hostname: host,
        port,
        socket: {
          data() {},
        },
      });
      const bound = server.port ?? port;
      server.stop(true);
      return bound;
    } catch {
      /* port in use */
    }
  }
  throw new Error("no free TCP port for BizHawk Lua IPC");
}

export function writeLuaPortFile(portFile: string, port: number): void {
  writeFileSync(portFile, `${port}\n`, "utf8");
}

export async function readLuaPortFile(portFile: string): Promise<number> {
  const port = Number((await readText(portFile)).trim());
  if (!Number.isFinite(port) || port <= 0 || port >= 65536) {
    throw new Error(`invalid lua port in ${portFile}`);
  }
  return port;
}

/**
 * TCP client bridge to `server.lua` inside BizHawk.
 * Lua listens; this process connects and sends `CMD|id|COMMAND|...` lines.
 */
export class BizhawkIpc {
  private socket: Socket | null = null;
  private buffer = "";
  private pending: Pending | null = null;
  private queue: Array<{ line: string; resolve: (ok: boolean) => void }> = [];
  private processing = false;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly host: string;
  private listenPort: number;
  ready = false;
  addr: string;
  private bizhawkLaunched = true;

  constructor(private readonly opts: BizhawkIpcOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.listenPort = opts.port ?? 55355;
    this.addr = `${this.host}:${this.listenPort}`;
  }

  get port(): number {
    return this.listenPort;
  }

  setBizhawkLaunched(launched: boolean): void {
    this.bizhawkLaunched = launched;
    if (!launched) this.ready = false;
    if (launched) void this.scheduleReconnect(0);
  }

  async start(): Promise<number> {
    if (this.opts.portFile) {
      try {
        this.listenPort = await readLuaPortFile(this.opts.portFile);
      } catch {
        /* file may not exist yet; caller should write before BizHawk launch */
      }
    }
    this.addr = `${this.host}:${this.listenPort}`;
    this.stopped = false;
    void this.scheduleReconnect(0);
    return this.listenPort;
  }

  stop(): void {
    this.stopped = true;
    this.ready = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.end();
    this.socket = null;
    while (this.queue.length > 0) {
      this.queue.shift()!.resolve(false);
    }
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(false);
      this.pending = null;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async sendCommand(parts: string[]): Promise<void> {
    const id = `${Date.now()}`;
    const line = `CMD|${id}|${parts.join("|")}`;
    const ok = await this.sendLine(line);
    if (!ok) throw new Error("bizhawk ipc command failed");
  }

  async sendPause(): Promise<void> {
    await this.sendCommand(["PAUSE"]);
  }

  async sendResume(): Promise<void> {
    await this.sendCommand(["RESUME"]);
  }

  async sendSwap(game: string, instanceId: string): Promise<void> {
    await this.sendCommand(["SWAP", game, instanceId]);
  }

  async sendMessage(text: string, style: BizhawkMessageStyle = {}): Promise<void> {
    const s = { ...DEFAULT_MESSAGE_STYLE, ...style };
    await this.sendCommand([
      "MSG",
      text,
      String(s.duration),
      String(s.x),
      String(s.y),
      String(s.fontsize),
      s.fg,
      s.bg,
    ]);
  }

  async sendSave(instanceId?: string): Promise<void> {
    const parts = instanceId ? ["SAVE", instanceId] : ["SAVE"];
    await this.sendCommand(parts);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.tryConnect(), delayMs);
  }

  private async tryConnect(): Promise<void> {
    if (this.stopped || this.socket) return;
    if (!this.bizhawkLaunched) {
      this.scheduleReconnect(500);
      return;
    }
    try {
      await this.connectOnce();
      this.reconnectAttempt = 0;
    } catch {
      const delay = luaReconnectDelayMs(this.reconnectAttempt++);
      this.scheduleReconnect(delay);
    }
  }

  private async connectOnce(): Promise<void> {
    const socket = await Promise.race([
      Bun.connect({
        hostname: this.host,
        port: this.listenPort,
        socket: {
          data: (_sock, data) => this.onData(String(data)),
          close: () => this.onSocketClose(),
          error: () => this.onSocketClose(),
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`connect timeout ${this.addr}`)), 2000)
      ),
    ]);
    this.attachSocket(socket);
  }

  private attachSocket(sock: Socket): void {
    if (this.socket) this.socket.end();
    this.socket = sock;
    this.buffer = "";
  }

  private onSocketClose(): void {
    this.ready = false;
    this.socket = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(false);
      this.pending = null;
    }
    if (!this.stopped) this.scheduleReconnect(luaReconnectDelayMs(this.reconnectAttempt++));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    const parts = line.split("|");
    const head = parts[0];
    if (head === MSG_HELLO) {
      const wasReady = this.ready;
      this.ready = true;
      this.reconnectAttempt = 0;
      if (!wasReady) this.opts.onReady?.();
      void this.processQueue();
      return;
    }
    if (head === MSG_ACK || head === MSG_NACK) {
      const id = parts[1];
      if (this.pending && this.pending.id === id) {
        clearTimeout(this.pending.timer);
        this.pending.resolve(head === MSG_ACK);
        this.pending = null;
        void this.processQueue();
      }
    }
  }

  private sendLine(line: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.queue.push({ line, resolve });
      void this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.processing || this.pending || this.queue.length === 0) return;
    if (!this.socket) {
      while (this.queue.length > 0) this.queue.shift()!.resolve(false);
      return;
    }

    const item = this.queue.shift()!;
    const id = item.line.split("|")[1];
    if (!id) {
      item.resolve(false);
      void this.processQueue();
      return;
    }

    this.processing = true;
    const timer = setTimeout(() => {
      if (this.pending?.id === id) {
        this.pending.resolve(false);
        this.pending = null;
      }
      this.processing = false;
      item.resolve(false);
      void this.processQueue();
    }, this.opts.timeoutMs ?? IPC_TIMEOUT_MS);

    this.pending = {
      id,
      resolve: (ok) => {
        clearTimeout(timer);
        this.processing = false;
        item.resolve(ok);
        void this.processQueue();
      },
      timer,
    };

    this.socket.write(`${item.line}\n`);
  }
}
