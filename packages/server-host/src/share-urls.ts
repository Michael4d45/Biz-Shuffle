import { networkInterfaces } from "node:os";

export type ShareUrls = {
  lan: string[];
  wan: string | null;
  local_only: boolean;
};

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

function isWildcardBind(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

function lanIpv4Addresses(): string[] {
  const ips = new Set<string>();
  for (const iface of Object.values(networkInterfaces())) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      ips.add(addr.address);
    }
  }
  return [...ips].sort();
}

function joinUrl(host: string, port: number): string {
  const needsBrackets = host.includes(":");
  const hostPart = needsBrackets ? `[${host}]` : host;
  return `http://${hostPart}:${port}`;
}

export function buildLanShareUrls(listenHost: string, port: number): string[] {
  if (isLoopbackHost(listenHost)) return [];
  if (isWildcardBind(listenHost)) {
    return lanIpv4Addresses().map((ip) => joinUrl(ip, port));
  }
  return [joinUrl(listenHost, port)];
}

export function isLocalOnlyBind(listenHost: string): boolean {
  return isLoopbackHost(listenHost);
}

/** Host to put in UDP discovery when the socket bind is a wildcard. */
export function discoveryAdvertiseHost(bindHost: string): string {
  if (isLoopbackHost(bindHost)) return bindHost;
  if (isWildcardBind(bindHost)) {
    const ips = lanIpv4Addresses();
    return ips[0] ?? "127.0.0.1";
  }
  return bindHost;
}

export async function resolveShareUrls(
  listenHost: string,
  port: number,
  fetchPublicIp: () => Promise<string | null> = defaultFetchPublicIp
): Promise<ShareUrls> {
  const local_only = isLocalOnlyBind(listenHost);
  const lan = buildLanShareUrls(listenHost, port);
  let wan: string | null = null;
  if (!local_only) {
    const publicIp = await fetchPublicIp();
    if (publicIp) wan = joinUrl(publicIp, port);
  }
  return { lan, wan, local_only };
}

async function defaultFetchPublicIp(): Promise<string | null> {
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ip?: string };
    const ip = body.ip?.trim();
    return ip || null;
  } catch {
    return null;
  }
}
