import type {
  SavestateErrorCode,
  VerifySavestateFail,
  VerifySavestateOptions,
  VerifySavestateResult,
} from "./types.js";
import {
  LUMP_BIZ_VERSION,
  LUMP_CORE_BIN,
  LUMP_CORE_TEXT,
  LUMP_INPUT,
  LUMP_SYNC,
  LUMP_ZIP_VERSION,
  checkTimeline,
  openZipArchive,
  parseInputLog,
  readFirstLine,
  readFirstNonEmptyLine,
  readLumpBytes,
  sanityCheckCoreBinary,
} from "./zip-entries.js";

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

function fail(code: SavestateErrorCode, message: string, detail?: unknown): VerifySavestateFail {
  return { ok: false, code, message, detail };
}

function toBytes(input: Uint8Array | Buffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function hasZipMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return (
    bytes[0] === ZIP_MAGIC[0] &&
    bytes[1] === ZIP_MAGIC[1] &&
    bytes[2] === ZIP_MAGIC[2] &&
    bytes[3] === ZIP_MAGIC[3]
  );
}

/** Fast gate: ZIP + required BizHawk lumps present (no decompression). */
export function isProbablyBizHawkSavestate(input: Uint8Array | Buffer): boolean {
  const fileBytes = toBytes(input);
  if (!hasZipMagic(fileBytes)) return false;
  try {
    const entries = openZipArchive(fileBytes);
    const hasVersion = entries.has(LUMP_ZIP_VERSION) || entries.has(`${LUMP_ZIP_VERSION}.zst`);
    const hasCore =
      entries.has(LUMP_CORE_BIN) ||
      entries.has(`${LUMP_CORE_BIN}.zst`) ||
      entries.has(LUMP_CORE_TEXT) ||
      entries.has(`${LUMP_CORE_TEXT}.zst`);
    return hasVersion && hasCore;
  } catch {
    return false;
  }
}

/** Structural / policy verification for a BizHawk `.state` (ZIP) save file. */
export function verifyBizHawkSavestate(
  input: Uint8Array | Buffer,
  options: VerifySavestateOptions = {}
): VerifySavestateResult {
  const fileBytes = toBytes(input);
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;

  if (fileBytes.length > maxBytes) {
    return fail("FILE_TOO_LARGE", `save exceeds ${maxBytes} bytes`);
  }
  if (!hasZipMagic(fileBytes)) {
    return fail("NOT_ZIP_SAVESTATE", "file is not a ZIP-based BizHawk savestate");
  }

  let entries;
  try {
    entries = openZipArchive(fileBytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "DUPLICATE_LUMP") {
      return fail("DUPLICATE_LUMP", "duplicate lump in savestate archive");
    }
    return fail("ZIP_CORRUPT", "savestate ZIP archive is corrupt or unreadable");
  }

  if (!entries.has(LUMP_ZIP_VERSION) && !entries.has(`${LUMP_ZIP_VERSION}.zst`)) {
    return fail("MISSING_BIZSTATE_VERSION", 'missing "BizState 1" version lump');
  }

  let formatVersion = "1.0.0";
  let zipSubVersion = 0;
  try {
    const verBytes = readLumpBytes(entries, LUMP_ZIP_VERSION, formatVersion);
    if (!verBytes) {
      return fail("MISSING_BIZSTATE_VERSION", 'missing "BizState 1" version lump');
    }
    const zipSubVersionStr = readFirstLine(verBytes);
    zipSubVersion = Number(zipSubVersionStr);
    if (!Number.isInteger(zipSubVersion)) {
      return fail("INVALID_BIZSTATE_VERSION", "BizState version lump is not an integer");
    }
    formatVersion = `1.0.${zipSubVersion}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "ZSTD_DECOMPRESS_FAILED") {
      return fail("ZIP_CORRUPT", "failed to decompress BizState version lump");
    }
    throw err;
  }

  const hasCoreBin = entries.has(LUMP_CORE_BIN) || entries.has(`${LUMP_CORE_BIN}.zst`);
  const hasCoreText = entries.has(LUMP_CORE_TEXT) || entries.has(`${LUMP_CORE_TEXT}.zst`);
  if (!hasCoreBin && !hasCoreText) {
    return fail("MISSING_CORE_STATE", "missing Core.bin and CoreText lumps");
  }

  if (options.expectedEmuVersion) {
    try {
      const bizVerBytes = readLumpBytes(entries, LUMP_BIZ_VERSION, formatVersion);
      if (!bizVerBytes) {
        return fail("MISSING_BIZ_VERSION", "missing BizVersion.txt lump");
      }
      const emuVer = readFirstLine(bizVerBytes);
      if (emuVer !== options.expectedEmuVersion) {
        return fail("EMU_VERSION_MISMATCH", "emulator version mismatch", { got: emuVer });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "ZSTD_DECOMPRESS_FAILED") {
        return fail("ZIP_CORRUPT", "failed to decompress BizVersion lump");
      }
      throw err;
    }
  }

  if (options.expectedSyncSettings) {
    try {
      const syncBytes = readLumpBytes(entries, LUMP_SYNC, formatVersion);
      if (!syncBytes) {
        return fail("MISSING_SYNC_SETTINGS", "missing SyncSettings.json lump");
      }
      const syncJson = readFirstNonEmptyLine(syncBytes);
      if (syncJson !== options.expectedSyncSettings) {
        return fail("SYNC_SETTINGS_MISMATCH", "sync settings JSON mismatch");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "ZSTD_DECOMPRESS_FAILED") {
        return fail("ZIP_CORRUPT", "failed to decompress SyncSettings lump");
      }
      throw err;
    }
  }

  let frame: number | null = null;
  const inputLump = entries.get(LUMP_INPUT) ?? entries.get(`${LUMP_INPUT}.zst`);
  if (inputLump) {
    try {
      const inputBytes = readLumpBytes(entries, LUMP_INPUT, formatVersion);
      if (inputBytes) {
        const parsed = parseInputLog(new TextDecoder().decode(inputBytes));
        frame = parsed.frame;
        if (options.expectedMovieInputLog) {
          const timeline = checkTimeline(options.expectedMovieInputLog, parsed.lines, parsed.frame);
          if (!timeline.ok) {
            return fail("MOVIE_MISMATCH", "input log does not match expected movie", {
              detail: timeline.detail,
            });
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "ZSTD_DECOMPRESS_FAILED") {
        return fail("ZIP_CORRUPT", "failed to decompress Input Log lump");
      }
      throw err;
    }
  }

  if (hasCoreBin && options.systemId) {
    try {
      const coreBytes = readLumpBytes(entries, LUMP_CORE_BIN, formatVersion);
      if (coreBytes) {
        const sanity = sanityCheckCoreBinary(coreBytes, options.systemId);
        if (!sanity.ok) {
          return fail("CORE_BLOB_SUSPECT", "core binary failed sanity check", {
            detail: sanity.detail,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "ZSTD_DECOMPRESS_FAILED") {
        return fail("ZIP_CORRUPT", "failed to decompress Core lump");
      }
      throw err;
    }
  }

  return {
    ok: true,
    formatVersion,
    zipSubVersion,
    frame,
    hasCoreText: hasCoreText,
  };
}
