import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migratePluginStatus, parseKv, writeKv, type Plugin, type PluginStatus } from "@bizshuffle-bun/protocol";

export function loadSettingsKv(path: string): Record<string, string> {
  if (!existsSync(path)) return { status: "disabled" };
  const settings = parseKv(readFileSync(path, "utf8"));
  if (!settings.status) settings.status = "disabled";
  return settings;
}

export function saveSettingsKv(settings: Record<string, string>, path: string): void {
  const data = { ...settings };
  if (!data.status) data.status = "disabled";
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, writeKv(data, { statusFirst: true }), "utf8");
  renameSync(tmp, path);
}

export function loadPluginMeta(metaPath: string, pluginName: string): Partial<Plugin> {
  if (!existsSync(metaPath)) return { name: pluginName };
  const meta = parseKv(readFileSync(metaPath, "utf8"));
  return {
    name: meta.name ?? pluginName,
    version: meta.version ?? "",
    description: meta.description ?? "",
    author: meta.author ?? "",
    bizhawk_version: meta.bizhawk_version ?? "",
  };
}

export function migratePluginStatusFile(pluginsDir: string, pluginName: string): void {
  const pluginDir = join(pluginsDir, pluginName);
  const metaKV = join(pluginDir, "meta.kv");
  const settingsKV = join(pluginDir, "settings.kv");
  if (existsSync(settingsKV)) return;
  if (!existsSync(metaKV)) {
    saveSettingsKv({ status: "disabled" }, settingsKV);
    return;
  }
  const meta = parseKv(readFileSync(metaKV, "utf8"));
  saveSettingsKv(migratePluginStatus(meta), settingsKV);
}

export function loadPluginMetadata(pluginsDir: string, pluginName: string): Plugin | null {
  const pluginDir = join(pluginsDir, pluginName);
  const metaKV = join(pluginDir, "meta.kv");
  const settingsKV = join(pluginDir, "settings.kv");
  migratePluginStatusFile(pluginsDir, pluginName);
  const partial = loadPluginMeta(metaKV, pluginName);
  const settings = loadSettingsKv(settingsKV);
  const status = (settings.status ?? "disabled") as PluginStatus;
  return {
    name: partial.name ?? pluginName,
    version: partial.version ?? "",
    description: partial.description ?? "",
    author: partial.author ?? "",
    bizhawk_version: partial.bizhawk_version ?? "",
    status,
  };
}

export function loadPluginsFromDisk(pluginsDir: string): Record<string, Plugin> {
  const plugins: Record<string, Plugin> = {};
  if (!existsSync(pluginsDir)) return plugins;
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const plugin = loadPluginMetadata(pluginsDir, entry.name);
    if (plugin) plugins[entry.name] = plugin;
  }
  return plugins;
}

export function scanPluginsDir(pluginsDir: string): void {
  mkdirSync(pluginsDir, { recursive: true });
}
