import { createWriteStream, unlinkSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

/** MSVC 2015–2022 x64 redistributable (BizHawk on Windows). */
export const VC_REDIST_X64_URL = "https://aka.ms/vs/17/release/vc_redist.x64.exe";

export type VCRedistStatus = {
  required: boolean;
  installed: boolean;
};

export function isVCRedistRequired(): boolean {
  return process.platform === "win32";
}

function queryRegInstalled(key: string): boolean {
  try {
    const out = execSync(`reg query "${key}" /v Installed`, {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /REG_DWORD\s+0x1/.test(out) || /\b0x1\b/.test(out);
  } catch {
    return false;
  }
}

/** True when the VS 2015–2022 x64 runtime is registered. */
export function isVCRedistInstalled(): boolean {
  if (!isVCRedistRequired()) return true;
  const keys = [
    "HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64",
  ];
  return keys.some(queryRegInstalled);
}

export function getVCRedistStatus(): VCRedistStatus {
  const required = isVCRedistRequired();
  return {
    required,
    installed: required ? isVCRedistInstalled() : true,
  };
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (pct: number, msg: string) => void
): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: ${url} (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let done = 0;
  let lastPct = -1;
  const reader = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream);
  const out = createWriteStream(dest);
  reader.on("data", (chunk: Buffer | string) => {
    done += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    if (total > 0 && onProgress) {
      const pct = Math.min(99, Math.round((done / total) * 100));
      if (pct !== lastPct) {
        lastPct = pct;
        onProgress(pct, "Downloading Visual C++ runtime…");
      }
    }
  });
  await pipeline(reader, out);
  onProgress?.(100, "Download complete");
}

/** Download and install the MSVC x64 redistributable (Windows only). */
export async function installVCRedist(
  onProgress?: (pct: number, msg: string) => void
): Promise<void> {
  if (!isVCRedistRequired()) return;
  if (isVCRedistInstalled()) return;

  const dest = join(tmpdir(), "bizshuffle-vc-redist-x64.exe");
  onProgress?.(0, "Downloading Visual C++ runtime…");
  await downloadFile(VC_REDIST_X64_URL, dest, onProgress);

  onProgress?.(100, "Installing Visual C++ runtime…");
  const result = spawnSync(dest, ["/install", "/quiet", "/norestart"], {
    windowsHide: true,
    stdio: "ignore",
  });
  try {
    unlinkSync(dest);
  } catch {
    /* ignore */
  }

  if (result.status !== 0 && result.status !== 1638) {
    // 1638 = newer version already installed
    throw new Error(`Visual C++ runtime installer exited with code ${result.status ?? "unknown"}`);
  }

  if (!isVCRedistInstalled()) {
    throw new Error("Visual C++ runtime install finished but runtime was not detected");
  }
  onProgress?.(100, "Visual C++ runtime ready");
}
