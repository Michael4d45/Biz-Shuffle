import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";
import {
  defaultDiscoveryConfig,
  newDiscoveryMessage,
  type DiscoveryConfig,
} from "@bizshuffle-bun/protocol";

export class DiscoveryBroadcaster {
  private socket: Socket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly config: DiscoveryConfig,
    private serverHost: string,
    private serverPort: number,
    private serverName: string
  ) {}

  start(): void {
    if (this.running) return;
    this.setupSocket();
    this.running = true;
    this.timer = setInterval(
      () => void this.broadcast(),
      this.config.broadcast_interval_sec * 1000
    );
    void this.broadcast();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
  }

  updateEndpoint(host: string, port: number, name: string): void {
    this.serverHost = host;
    this.serverPort = port;
    this.serverName = name;
  }

  private setupSocket(): void {
    const [host, portStr] = this.config.multicast_address.split(":");
    const port = Number(portStr ?? 1900);
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    socket.on("error", (err) => {
      console.warn(`[discovery] UDP error (non-fatal): ${err.message}`);
    });

    let localAddress = this.serverHost;
    for (const iface of Object.values(networkInterfaces())) {
      if (!iface) continue;
      for (const addr of iface) {
        if (addr.family === "IPv4" && addr.address === this.serverHost) {
          localAddress = addr.address;
          break;
        }
      }
    }

    socket.bind(0, localAddress, () => {
      try {
        socket.setMulticastInterface(localAddress);
      } catch {
        /* ignore on platforms without multicast interface */
      }
      this.socket = socket;
      this.multicastTarget = { host: host ?? "239.255.255.250", port };
    });
  }

  private multicastTarget = { host: "239.255.255.250", port: 1900 };

  private async broadcast(): Promise<void> {
    if (!this.running || !this.socket) return;
    try {
      const msg = newDiscoveryMessage(this.serverHost, this.serverPort, this.serverName);
      const data = Buffer.from(JSON.stringify(msg));
      const { host, port } = this.multicastTarget;
      await new Promise<void>((resolve) => {
        this.socket!.send(data, port, host, () => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        const probe = createSocket("udp4");
        probe.on("error", () => resolve());
        probe.send(data, 1901, "127.0.0.1", () => {
          probe.close();
          resolve();
        });
      });
    } catch (err) {
      console.warn(`[discovery] broadcast failed (non-fatal): ${String(err)}`);
    }
  }
}

export function createDiscoveryBroadcaster(
  host: string,
  port: number,
  serverName: string,
  config = defaultDiscoveryConfig()
): DiscoveryBroadcaster {
  return new DiscoveryBroadcaster(config, host, port, serverName);
}
