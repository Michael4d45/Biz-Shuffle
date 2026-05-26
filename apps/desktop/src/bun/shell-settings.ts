import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, saveConfig } from "@bizshuffle-bun/client-host";
import type { ShellSettings } from "../shared/rpc.js";

const SETTINGS_FILE = "settings.json";

export function defaultShellSettings(): ShellSettings {
  return {
    bindHost: "127.0.0.1",
    hostPort: 8080,
    serverUrl: "http://127.0.0.1:8080",
    playerName: "",
  };
}

function settingsPath(dataDir: string): string {
  return join(dataDir, SETTINGS_FILE);
}

function normalizeHostPort(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 65535) {
    return fallback;
  }
  return n;
}

function mergeShellSettings(partial: Partial<ShellSettings>): ShellSettings {
  const defaults = defaultShellSettings();
  const bindHost = (partial.bindHost ?? defaults.bindHost).trim();
  const serverUrl = (partial.serverUrl ?? defaults.serverUrl).trim();
  return {
    bindHost: bindHost || defaults.bindHost,
    hostPort: normalizeHostPort(partial.hostPort, defaults.hostPort),
    serverUrl: serverUrl || defaults.serverUrl,
    playerName: (partial.playerName ?? defaults.playerName).trim(),
  };
}

function readSettingsFile(dataDir: string): ShellSettings | null {
  const path = settingsPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ShellSettings>;
    return mergeShellSettings(parsed);
  } catch {
    return null;
  }
}

function legacySettingsFromConfig(dataDir: string): ShellSettings {
  const base = defaultShellSettings();
  try {
    const cfg = loadConfig(dataDir);
    if (cfg.bind_host) base.bindHost = cfg.bind_host;
    if (cfg.server) {
      base.serverUrl = cfg.server;
      try {
        const port = Number(new URL(cfg.server).port);
        if (Number.isInteger(port) && port > 0) base.hostPort = port;
      } catch {
        /* ignore */
      }
    }
    if (cfg.name) base.playerName = cfg.name;
  } catch {
    /* ignore */
  }
  return base;
}

function writeSettingsFile(dataDir: string, settings: ShellSettings): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(settingsPath(dataDir), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function loadShellSettings(dataDir: string): ShellSettings {
  const fromFile = readSettingsFile(dataDir);
  if (fromFile) return fromFile;

  const migrated = legacySettingsFromConfig(dataDir);
  writeSettingsFile(dataDir, migrated);
  return migrated;
}

function syncClientConfig(dataDir: string, settings: ShellSettings): void {
  try {
    const cfg = loadConfig(dataDir);
    cfg.bind_host = settings.bindHost;
    cfg.server = settings.serverUrl;
    cfg.name = settings.playerName;
    saveConfig(dataDir, cfg);
  } catch {
    /* ignore */
  }
}

export function saveShellSettings(dataDir: string, patch: Partial<ShellSettings>): ShellSettings {
  const current = readSettingsFile(dataDir) ?? legacySettingsFromConfig(dataDir);
  const next = mergeShellSettings({ ...current, ...patch });
  writeSettingsFile(dataDir, next);
  syncClientConfig(dataDir, next);
  return next;
}
