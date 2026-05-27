import { createSocket, type Socket } from "node:dgram";
import {
  defaultDiscoveryConfig,
  isDiscoveryValid,
  type DiscoveryConfig,
  type DiscoveryMessage,
} from "@bizshuffle-bun/protocol";

export interface DiscoveredServer {
  message: DiscoveryMessage;
  wsUrl: string;
}

export class DiscoveryListener {
  private socket: Socket | null = null;
  private readonly discovered = new Map<string, DiscoveredServer>();
  private running = false;

  constructor(
    private readonly config: DiscoveryConfig = defaultDiscoveryConfig(),
    private readonly onFound?: (server: DiscoveredServer) => void
  ) {}

  start(): void {
    if (this.running || !this.config.enabled) return;
    this.running = true;
    const [host, portStr] = this.config.multicast_address.split(":");
    const port = Number.parseInt(portStr ?? "1900", 10);
    const sock = createSocket({ type: "udp4", reuseAddr: true });
    this.socket = sock;
    sock.on("message", (buf) => {
      try {
        const msg = JSON.parse(buf.toString()) as DiscoveryMessage;
        if (!isDiscoveryValid(msg)) return;
        const wsUrl = `ws://${msg.host}:${msg.port}/ws`;
        const entry = { message: msg, wsUrl };
        this.discovered.set(msg.server_id, entry);
        this.onFound?.(entry);
      } catch {
        /* ignore */
      }
    });
    sock.bind(port, host, () => {
      try {
        sock.addMembership(host);
      } catch {
        /* non-multicast ok */
      }
    });
  }

  stop(): void {
    this.running = false;
    this.socket?.close();
    this.socket = null;
    this.discovered.clear();
  }

  pruneExpired(now = Date.now()): void {
    const maxAge = this.config.listen_timeout_sec * 1000;
    for (const [id, s] of this.discovered) {
      const ts = new Date(s.message.timestamp).getTime();
      if (now - ts > maxAge) this.discovered.delete(id);
    }
  }

  removeByEndpoint(host: string, port: number): void {
    for (const [id, s] of this.discovered) {
      if (s.message.host === host && s.message.port === port) {
        this.discovered.delete(id);
      }
    }
  }

  removeLocalPort(port: number): void {
    const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
    for (const [id, s] of this.discovered) {
      if (s.message.port === port && localHosts.has(s.message.host)) {
        this.discovered.delete(id);
      }
    }
  }

  removeMatchingUrl(url: string): void {
    try {
      const u = new URL(url);
      const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
      const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
      if (localHosts.has(u.hostname)) {
        this.removeLocalPort(port);
        return;
      }
      this.removeByEndpoint(u.hostname, port);
    } catch {
      /* ignore */
    }
  }

  getDiscovered(): DiscoveredServer[] {
    const now = Date.now();
    this.pruneExpired(now);
    const maxAge = this.config.listen_timeout_sec * 1000;
    return [...this.discovered.values()].filter((s) => {
      const ts = new Date(s.message.timestamp).getTime();
      return now - ts <= maxAge;
    });
  }
}
