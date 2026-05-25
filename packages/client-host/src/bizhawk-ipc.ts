import { connect as netConnect, createServer, type Socket } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import { IPC_TIMEOUT_MS, luaReconnectDelayMs } from "@bizshuffle-bun/protocol";

const MSG_ACK = "ACK";
const MSG_NACK = "NACK";
const MSG_HELLO = "HELLO";

export interface BizhawkIpcOptions {
  host?: string;
  /** Fixed port to dial (Lua listens here). */
  port?: number;
  /** Path to `lua_server_port.txt` (read on start). */
  portFile?: string;
  timeoutMs?: number;
}

type Pending = { id: string; resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> };

/** Find a free TCP port starting at 55355 (default Lua IPC port). */
export async function reserveLuaPort(host = "127.0.0.1", start = 55355): Promise<number> {
  for (let port = start; port < 65535; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const s = createServer();
        s.once("error", reject);
        s.listen(port, host, () => s.close(() => resolve()));
      });
      return port;
    } catch {
      /* port in use */
    }
  }
  throw new Error("no free TCP port for BizHawk Lua IPC");
}

export function writeLuaPortFile(portFile: string, port: number): void {
  writeFileSync(portFile, `${port}\n`, "utf8");
}

export function readLuaPortFile(portFile: string): number {
  const port = Number(readFileSync(portFile, "utf8").trim());
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

  /** Port Lua is listening on (for tests/diagnostics). */
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
        this.listenPort = readLuaPortFile(this.opts.portFile);
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
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    // Keep lua_server_port.txt — BizHawk reads it at launch; deleting here causes port drift on reconnect.
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

  async sendMessage(text: string): Promise<void> {
    await this.sendCommand(["MSG", text, "3.0", "10", "10", "12", "#FFFFFF", "#000000"]);
  }

  async sendSave(): Promise<void> {
    await this.sendCommand(["SAVE"]);
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

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = netConnect({ host: this.host, port: this.listenPort });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`connect timeout ${this.addr}`));
      }, 2000);

      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.once("connect", () => {
        clearTimeout(timer);
        this.attachSocket(socket);
        resolve();
      });
    });
  }

  private attachSocket(sock: Socket): void {
    if (this.socket) this.socket.destroy();
    this.socket = sock;
    this.buffer = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk: Buffer | string) => this.onData(String(chunk)));
    sock.on("close", () => {
      this.ready = false;
      this.socket = null;
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.resolve(false);
        this.pending = null;
      }
      if (!this.stopped) this.scheduleReconnect(luaReconnectDelayMs(this.reconnectAttempt++));
    });
    sock.on("error", () => {
      sock.destroy();
    });
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
      this.ready = true;
      this.reconnectAttempt = 0;
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
    if (!this.socket || this.socket.destroyed) {
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

    this.socket.write(`${item.line}\n`, () => {
      /* wait for ACK/NACK */
    });
  }
}
