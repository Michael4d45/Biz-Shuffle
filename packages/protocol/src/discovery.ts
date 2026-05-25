import { DISCOVERY_VALID_MS, type DiscoveryMessage } from "./schemas.js";

export function newDiscoveryMessage(
  host: string,
  port: number,
  serverName: string
): DiscoveryMessage {
  return {
    type: "bizshuffle_server",
    version: "1.0",
    server_name: serverName,
    host,
    port,
    timestamp: new Date().toISOString(),
    server_id: `${host}:${port}`,
  };
}

export function isDiscoveryValid(msg: DiscoveryMessage, now = Date.now()): boolean {
  if (msg.type !== "bizshuffle_server" || !msg.host || msg.port <= 0) return false;
  const ts = new Date(msg.timestamp).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts <= DISCOVERY_VALID_MS;
}

export function getServerWsUrl(host: string, port: number): string {
  return `ws://${host}:${port}/ws`;
}
