import { unzipSync } from "fflate";
import { decompress } from "fzstd";

export type ZipLump = {
  relPath: string;
  data: Uint8Array;
  compressed: boolean;
};

const LUMP_ZIP_VERSION = "BizState 1";
const LUMP_BIZ_VERSION = "BizVersion";
const LUMP_CORE_BIN = "Core";
const LUMP_CORE_TEXT = "CoreText";
const LUMP_SYNC = "SyncSettings";
const LUMP_INPUT = "Input Log";

export { LUMP_ZIP_VERSION, LUMP_BIZ_VERSION, LUMP_CORE_BIN, LUMP_CORE_TEXT, LUMP_SYNC, LUMP_INPUT };

function longestCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  let prefix = paths[0]!;
  for (const p of paths.slice(1)) {
    while (prefix.length > 0 && !p.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) break;
  }
  if (prefix.length > 0 && !prefix.endsWith("/") && !prefix.endsWith("\\")) {
    return "";
  }
  return prefix;
}

/** Mirrors BizHawk ZipStateLoader entry naming. */
export function normalizeZipEntries(files: Record<string, Uint8Array>): Map<string, ZipLump> {
  const paths = Object.keys(files).filter((p) => !p.endsWith("/"));
  const commonPrefix = longestCommonPrefix(paths);
  const result = new Map<string, ZipLump>();

  for (const [fullName, data] of Object.entries(files)) {
    if (fullName.endsWith("/")) continue;

    let rel = fullName;
    if (commonPrefix.length > 0 && rel.startsWith(commonPrefix)) {
      rel = rel.slice(commonPrefix.length);
    }
    rel = rel.replace(/\\/g, "/");

    const dot = rel.indexOf(".");
    const logicalBase = dot >= 0 ? rel.slice(0, dot) : rel;
    const logical = rel.endsWith(".zst") ? `${logicalBase}.zst` : logicalBase;

    if (result.has(logical)) {
      throw new Error("DUPLICATE_LUMP");
    }
    result.set(logical, {
      relPath: rel,
      data,
      compressed: rel.endsWith(".zst"),
    });
  }

  return result;
}

export function openZipArchive(fileBytes: Uint8Array): Map<string, ZipLump> {
  try {
    return normalizeZipEntries(unzipSync(fileBytes));
  } catch (err) {
    if (err instanceof Error && err.message === "DUPLICATE_LUMP") throw err;
    throw new Error("ZIP_CORRUPT");
  }
}

function isLegacyZstd(lump: ZipLump, formatVersion: string, lumpExt: string): boolean {
  if (lump.compressed) return true;
  if (formatVersion !== "1.0.2") return false;
  if (lumpExt === "bin" || lumpExt === "bmp") return true;
  return lump.relPath === "Greenzone";
}

export function readLumpBytes(
  entries: Map<string, ZipLump>,
  logicalName: string,
  formatVersion: string
): Uint8Array | null {
  const lump = entries.get(logicalName) ?? entries.get(`${logicalName}.zst`);
  if (!lump) return null;

  const ext = lump.relPath.includes(".") ? lump.relPath.split(".").pop() ?? "" : "";
  if (lump.compressed || isLegacyZstd(lump, formatVersion, ext)) {
    try {
      return decompress(lump.data);
    } catch {
      throw new Error("ZSTD_DECOMPRESS_FAILED");
    }
  }
  return lump.data;
}

export function readFirstLine(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  const line = text.split(/\r?\n/)[0] ?? "";
  return line.trim();
}

export function readFirstNonEmptyLine(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

export function parseInputLog(text: string): { frame: number; lines: string[] } {
  const lines: string[] = [];
  let frame = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("|")) {
      lines.push(line);
    } else if (line.startsWith("Frame ")) {
      const parts = line.split(/\s+/);
      const n = Number(parts[1]);
      if (Number.isFinite(n)) frame = n;
    }
  }
  if (frame === 0) frame = lines.length;
  return { frame, lines };
}

export function checkTimeline(
  movieLog: readonly string[],
  stateLog: readonly string[],
  stateFrame: number
): { ok: true } | { ok: false; detail: string } {
  if (stateFrame > stateLog.length) {
    return { ok: false, detail: "invalid frame number vs embedded log" };
  }
  if (movieLog.length < stateFrame) {
    return { ok: false, detail: "state frame beyond movie length" };
  }
  for (let i = 0; i < stateFrame; i++) {
    if (movieLog[i] !== stateLog[i]) {
      return { ok: false, detail: `input mismatch at frame ${i + 1}` };
    }
  }
  return { ok: true };
}

export function sanityCheckCoreBinary(raw: Uint8Array, systemId: string | null): { ok: true } | { ok: false; detail: string } {
  if (raw.length < 4) {
    return { ok: false, detail: "core blob too small" };
  }
  if (systemId === "GB") {
    const coreLen = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt32(0, true);
    if (coreLen <= 0 || coreLen > 10_000_000) {
      return { ok: false, detail: "implausible GB core length" };
    }
  }
  if (systemId === "N64") {
    const coreLen = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt32(0, true);
    if (coreLen < 16_788_288) {
      return { ok: false, detail: "N64 core blob too small" };
    }
  }
  return { ok: true };
}
