import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROM_DOWNLOAD_RETRIES, romRetryDelayMs } from "@bizshuffle-bun/protocol";
import { ensureDirSync, pathExists, writeBytesAtomic } from "./bun-io.js";

export async function ensureFile(
  baseUrl: string,
  dataDir: string,
  name: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const dest = join(dataDir, "roms", ...name.split("/"));
  if (pathExists(dest)) return;
  ensureDirSync(dirname(dest));
  const url = `${baseUrl.replace(/\/$/, "")}/files/${name}`;
  let lastErr: Error | undefined;
  for (let i = 0; i < ROM_DOWNLOAD_RETRIES; i++) {
    try {
      const res = await fetchFn(url);
      if (!res.ok || !res.body) throw new Error(`bad status ${res.status}`);
      await writeBytesAtomic(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (i < ROM_DOWNLOAD_RETRIES - 1) {
        await Bun.sleep(romRetryDelayMs(i));
      }
    }
  }
  throw lastErr ?? new Error("download failed");
}

export async function downloadPluginFiles(
  baseUrl: string,
  pluginsDir: string,
  pluginName: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const localDir = join(pluginsDir, pluginName);
  ensureDirSync(localDir);
  const remoteBase = `${baseUrl.replace(/\/$/, "")}/files/plugins/${pluginName}`;
  const files = ["plugin.lua", "meta.kv", "settings.kv"];
  for (const file of files) {
    const url = `${remoteBase}/${file}`;
    const dest = join(localDir, file);
    try {
      await downloadOne(url, dest, fetchFn, file !== "settings.kv");
    } catch (err) {
      if (file === "settings.kv") continue;
      throw err;
    }
  }
}

async function downloadOne(
  url: string,
  dest: string,
  fetchFn: typeof fetch,
  required: boolean
): Promise<void> {
  const res = await fetchFn(url);
  if (!res.ok) {
    if (!required) return;
    throw new Error(`${url}: ${res.status}`);
  }
  if (!res.body) throw new Error(`empty body for ${url}`);
  await writeBytesAtomic(dest, Buffer.from(await res.arrayBuffer()));
}

/** Download a host save into `{dataDir}/saves/{instanceId}.state` (no-op if missing on host). */
export async function ensureSaveFile(
  baseUrl: string,
  dataDir: string,
  instanceId: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const dest = join(dataDir, "saves", `${instanceId}.state`);
  if (pathExists(dest)) return;
  const url = `${baseUrl.replace(/\/$/, "")}/save/${instanceId}.state`;
  const res = await fetchFn(url);
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`save download failed: ${res.status}`);
  ensureDirSync(dirname(dest));
  await writeBytesAtomic(dest, Buffer.from(await res.arrayBuffer()));
}

export function waitForFileStable(path: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  let lastMtime = -1;
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const st = statSync(path);
        if (st.size === lastSize && st.mtimeMs === lastMtime) {
          resolve();
          return;
        }
        lastSize = st.size;
        lastMtime = st.mtimeMs;
      } catch (err) {
        reject(err);
        return;
      }
      if (Date.now() > deadline) {
        resolve();
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
