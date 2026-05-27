import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ClientConfigMap = Record<string, string>;

export function loadConfig(dataDir: string): ClientConfigMap {
  const path = join(dataDir, "config.json");
  try {
    const raw = readFileSync(path, "utf8");
    const cfg = JSON.parse(raw) as ClientConfigMap;
    normalizeServer(cfg);
    return cfg;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export function saveConfig(dataDir: string, cfg: ClientConfigMap): void {
  const path = join(dataDir, "config.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

export function ensureDefaults(cfg: ClientConfigMap): void {
  if (!cfg.discovery_enabled) cfg.discovery_enabled = "true";
  if (!cfg.discovery_timeout_seconds) cfg.discovery_timeout_seconds = "5";
  if (!cfg.multicast_address) cfg.multicast_address = "239.255.255.250:1900";
  if (!cfg.auto_open_bizhawk) cfg.auto_open_bizhawk = "true";
}

function normalizeServer(cfg: ClientConfigMap): void {
  const s = cfg.server;
  if (!s) return;
  try {
    const u = new URL(s);
    if (u.protocol === "ws:") u.protocol = "http:";
    if (u.protocol === "wss:") u.protocol = "https:";
    u.pathname = "";
    u.search = "";
    u.hash = "";
    cfg.server = u.toString().replace(/\/$/, "");
  } catch {
    /* keep raw */
  }
}

export function httpBaseFromServer(serverUrl: string): string {
  const u = new URL(serverUrl);
  if (u.protocol === "ws:") u.protocol = "http:";
  if (u.protocol === "wss:") u.protocol = "https:";
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

export function wsUrlFromHttpBase(base: string): string {
  const u = new URL(base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  return u.toString();
}
