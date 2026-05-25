import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ClientApiPort } from "./api.js";
import { downloadPluginFiles } from "./downloads.js";

export interface PluginSyncResult {
  totalPlugins: number;
  downloaded: number;
  removed: number;
  errors: string[];
}

export class PluginSyncManager {
  constructor(
    private readonly api: ClientApiPort,
    private readonly pluginsDir: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async syncPlugins(): Promise<PluginSyncResult> {
    const result: PluginSyncResult = { totalPlugins: 0, downloaded: 0, removed: 0, errors: [] };
    try {
      const serverPlugins = await this.api.getPlugins();
      result.totalPlugins = Object.keys(serverPlugins).length;
      const local = this.scanLocal();
      const toDownload = Object.keys(serverPlugins);
      const toRemove = Object.keys(local).filter((n) => !(n in serverPlugins));

      for (const name of toDownload) {
        try {
          await downloadPluginFiles(this.api.baseUrl, this.pluginsDir, name, this.fetchFn);
          result.downloaded++;
        } catch (err) {
          result.errors.push(`download ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      for (const name of toRemove) {
        try {
          rmSync(join(this.pluginsDir, name), { recursive: true, force: true });
          result.removed++;
        } catch (err) {
          result.errors.push(`remove ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
      throw err;
    }
    return result;
  }

  private scanLocal(): Record<string, true> {
    const out: Record<string, true> = {};
    if (!existsSync(this.pluginsDir)) return out;
    for (const name of readdirSync(this.pluginsDir, { withFileTypes: true })) {
      if (name.isDirectory()) out[name.name] = true;
    }
    return out;
  }
}
