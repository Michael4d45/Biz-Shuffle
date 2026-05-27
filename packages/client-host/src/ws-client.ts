import WebSocket from "ws";
import type { Command } from "@bizshuffle-bun/protocol";

const RECONNECT_MS = 2000;

export type SendFn = (cmd: Command) => Promise<void>;

export interface WsClientOptions {
  wsUrl: string;
  playerName: string;
  bizhawkReady?: boolean;
  /** Current BizHawk readiness for each reconnect hello (preferred over bizhawkReady). */
  getBizhawkReady?: () => boolean;
  onCommand: (cmd: Command) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  signal?: AbortSignal;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private sendQueue: Command[] = [];
  private running = false;
  private helloAcked = false;
  private helloResolve: (() => void) | null = null;
  helloAck!: Promise<void>;

  constructor(private readonly opts: WsClientOptions) {
    this.resetHelloHandshake();
    const origOnCommand = opts.onCommand;
    this.opts.onCommand = (cmd) => {
      if (cmd.cmd === "games_update" && !this.helloAcked) {
        this.helloAcked = true;
        this.helloResolve?.();
        this.helloResolve = null;
      }
      origOnCommand(cmd);
    };
  }

  private resetHelloHandshake(): void {
    this.helloAcked = false;
    this.helloAck = new Promise<void>((resolve) => {
      this.helloResolve = resolve;
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    void this.runLoop();
    await this.helloAck;
  }

  stop(): void {
    this.running = false;
    this.ws?.close();
    this.ws = null;
    this.sendQueue = [];
    this.resetHelloHandshake();
  }

  async send(cmd: Command): Promise<void> {
    if (!this.running) throw new Error("ws client stopped");
    this.sendQueue.push(cmd);
    this.flushSend();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private flushSend(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (this.sendQueue.length > 0) {
      const cmd = this.sendQueue.shift()!;
      ws.send(JSON.stringify(cmd));
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      if (this.opts.signal?.aborted) return;
      try {
        await this.connectOnce();
      } catch {
        /* reconnect */
      }
      if (!this.running) return;
      await new Promise((r) => setTimeout(r, RECONNECT_MS));
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.wsUrl);
      this.ws = ws;

      ws.on("open", () => {
        this.opts.onConnected?.();
        const hello: Command = {
          cmd: "hello",
          id: `hello-${Date.now()}`,
          payload: {
            name: this.opts.playerName,
            bizhawk_ready: this.opts.getBizhawkReady?.() ?? this.opts.bizhawkReady ?? false,
          },
        };
        ws.send(JSON.stringify(hello));
        this.flushSend();
      });

      ws.on("message", (data) => {
        try {
          const cmd = JSON.parse(data.toString()) as Command;
          if (cmd.cmd === "ack" || cmd.cmd === "nack") return;
          this.opts.onCommand(cmd);
        } catch {
          /* ignore */
        }
      });

      ws.on("close", () => {
        this.opts.onDisconnected?.();
        this.ws = null;
        resolve();
      });

      ws.on("error", (err) => {
        ws.close();
        reject(err);
      });

      this.opts.signal?.addEventListener("abort", () => {
        ws.close();
        resolve();
      });
    });
  }
}

export function createAckSender(send: SendFn) {
  return {
    ack: (id: string) => send({ cmd: "ack", id }),
    nack: (id: string, reason: string) => send({ cmd: "nack", id, payload: { reason } }),
  };
}
