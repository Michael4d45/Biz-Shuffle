import WebSocket from "ws";
import type { Command } from "@bizshuffle-bun/protocol";

export class WsTestClient {
  private ws: WebSocket | null = null;
  private readonly inbox: Command[] = [];

  constructor(private readonly wsUrl: string) {}

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.on("open", () => resolve());
      ws.on("error", reject);
      ws.on("message", (data) => {
        try {
          this.inbox.push(JSON.parse(data.toString()) as Command);
        } catch {
          /* ignore */
        }
      });
    });
  }

  send(cmd: Command): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("not connected");
    this.ws.send(JSON.stringify(cmd));
  }

  async hello(name: string, bizhawkReady = true): Promise<void> {
    this.send({
      cmd: "hello",
      id: `hello-${Date.now()}`,
      payload: { name, bizhawk_ready: bizhawkReady },
    });
    await this.waitFor(
      (c) =>
        c.cmd === "games_update" ||
        c.cmd === "swap" ||
        c.cmd === "start" ||
        c.cmd === "pause",
      10_000
    );
  }

  async helloAdmin(name = "admin"): Promise<void> {
    this.send({
      cmd: "hello_admin",
      id: `hello-admin-${Date.now()}`,
      payload: { name },
    });
  }

  drain(): Command[] {
    const out = [...this.inbox];
    this.inbox.length = 0;
    return out;
  }

  async waitFor(predicate: (cmd: Command) => boolean, timeoutMs = 5000): Promise<Command> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.inbox.find(predicate);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timeout waiting for command");
  }

  sendRaw(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("not connected");
    this.ws.send(data);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export function httpToWs(httpUrl: string): string {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  return u.toString();
}
