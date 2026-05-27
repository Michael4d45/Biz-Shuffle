import { statSync } from "node:fs";
import { join } from "node:path";
import { ensureDirSync, pathExists, readText, writeTextAtomic } from "./bun-io.js";
import {
  PERSIST_DEBOUNCE_MS,
  type FileState,
  type GameSwapInstance,
  type MutablePlugin,
  type MutableServerState,
  type Plugin,
  type ServerState,
} from "@bizshuffle-bun/protocol";
import {
  loadPluginsFromDisk,
  loadPluginMetadata,
  loadSettingsKv,
  saveSettingsKv,
} from "./plugins.js";
import { freshServerState, ServerSession } from "./session.js";

export interface PersistenceOptions {
  dataDir: string;
  session: ServerSession;
  onSaved?: (updatedAt: string) => void;
}

export class Persistence {
  readonly dataDir: string;
  private readonly statePath: string;
  private readonly pluginsDir: string;
  private readonly savesDir: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;

  constructor(private readonly opts: PersistenceOptions) {
    this.dataDir = opts.dataDir;
    this.statePath = join(opts.dataDir, "state.json");
    this.pluginsDir = join(opts.dataDir, "plugins");
    this.savesDir = join(opts.dataDir, "saves");
    ensureDirSync(opts.dataDir);
    ensureDirSync(join(opts.dataDir, "roms"));
    ensureDirSync(this.savesDir);
    ensureDirSync(this.pluginsDir);
  }

  get pluginsDirectory(): string {
    return this.pluginsDir;
  }

  get savesDirectory(): string {
    return this.savesDir;
  }

  async load(): Promise<void> {
    let tmp: MutableServerState;
    if (!pathExists(this.statePath)) {
      tmp = structuredClone(this.opts.session.snapshot) as MutableServerState;
    } else {
      try {
        const raw = JSON.parse(await readText(this.statePath)) as ServerState;
        tmp = { ...freshServerState(), ...raw } as MutableServerState;
      } catch {
        console.error("failed to load state from disk");
        return;
      }
    }

    tmp.game_instances ??= [];
    tmp.games ??= [];
    tmp.main_games ??= [];
    tmp.players ??= {};
    tmp.config_keys ??= ["DisplayFps"];
    if (!tmp.updated_at) tmp.updated_at = new Date().toISOString();

    for (const inst of tmp.game_instances) {
      const savePath = join(this.savesDir, `${inst.id}.state`);
      inst.file_state = pathExists(savePath) ? ("ready" as FileState) : ("none" as FileState);
      inst.pending_player = "";
    }

    for (const name of Object.keys(tmp.players)) {
      tmp.players[name] = { ...tmp.players[name]!, connected: false };
    }

    tmp.plugins = loadPluginsFromDisk(this.pluginsDir) as MutableServerState["plugins"];
    this.opts.session.setState(tmp);
    this.scheduleSave();
  }

  scheduleSave(): void {
    this.pending = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush();
    }, PERSIST_DEBOUNCE_MS);
  }

  async drain(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.pending) return;
    this.pending = false;
    try {
      const updatedAt = await this.saveState();
      this.opts.onSaved?.(updatedAt);
    } catch (err) {
      console.error("failed to persist state:", err);
    }
  }

  async saveState(): Promise<string> {
    const st = this.opts.session.snapshot;
    for (const plugin of Object.values(st.plugins ?? {})) {
      if (plugin.status === "error") {
        throw new Error(`not saving state due to plugin ${plugin.name}`);
      }
      await this.savePluginConfig(plugin);
    }
    const toWrite = { ...st, plugins: undefined };
    await writeTextAtomic(this.statePath, JSON.stringify(toWrite, null, 2) + "\n");
    return st.updated_at;
  }

  private async savePluginConfig(plugin: Plugin): Promise<void> {
    const pluginDir = join(this.pluginsDir, plugin.name);
    ensureDirSync(pluginDir);
    const settingsKV = join(pluginDir, "settings.kv");
    const settings = pathExists(settingsKV) ? loadSettingsKv(settingsKV) : { status: "disabled" };
    settings.status = plugin.status;
    saveSettingsKv(settings, settingsKV);
    const full = structuredClone(
      loadPluginMetadata(this.pluginsDir, plugin.name) ?? plugin
    ) as MutablePlugin;
    full.status = plugin.status;
    const current = this.opts.session.raw;
    current.plugins ??= {};
    current.plugins[plugin.name] = full;
  }

  refreshInstanceFileStates(instances: GameSwapInstance[]): GameSwapInstance[] {
    return instances.map((inst) => {
      const savePath = join(this.savesDir, `${inst.id}.state`);
      const file_state: FileState = pathExists(savePath) ? "ready" : "none";
      return { ...inst, file_state, pending_player: "" };
    });
  }

  instanceSavePath(instanceId: string): string {
    return join(this.savesDir, `${instanceId}.state`);
  }

  saveExists(instanceId: string): boolean {
    try {
      return statSync(this.instanceSavePath(instanceId)).isFile();
    } catch {
      return false;
    }
  }
}
