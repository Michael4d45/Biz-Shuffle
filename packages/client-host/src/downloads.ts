import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export async function ensureFile(
  baseUrl: string,
  dataDir: string,
  name: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const dest = join(dataDir, "roms", ...name.split("/"));
  if (existsSync(dest)) return;
  mkdirSync(dirname(dest), { recursive: true });
  const url = `${baseUrl.replace(/\/$/, "")}/files/${name}`;
  let lastErr: Error | undefined;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchFn(url);
      if (!res.ok || !res.body) throw new Error(`bad status ${res.status}`);
      const tmp = `${dest}.tmp`;
      await pipeline(
        Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream),
        createWriteStream(tmp)
      );
      const { renameSync } = await import("node:fs");
      renameSync(tmp, dest);
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      await new Promise((r) => setTimeout(r, 500));
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
  mkdirSync(localDir, { recursive: true });
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
  const tmp = `${dest}.tmp`;
  await pipeline(
    Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream),
    createWriteStream(tmp)
  );
  const { renameSync } = await import("node:fs");
  renameSync(tmp, dest);
}

/** Download a host save into `{dataDir}/saves/{instanceId}.state` (no-op if missing on host). */
export async function ensureSaveFile(
  baseUrl: string,
  dataDir: string,
  instanceId: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const dest = join(dataDir, "saves", `${instanceId}.state`);
  if (existsSync(dest)) return;
  const url = `${baseUrl.replace(/\/$/, "")}/save/${instanceId}.state`;
  const res = await fetchFn(url);
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`save download failed: ${res.status}`);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync, renameSync } = await import("node:fs");
  writeFileSync(tmp, buf);
  renameSync(tmp, dest);
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
