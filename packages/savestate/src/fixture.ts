import { zipSync } from "fflate";

/** Minimal valid BizHawk savestate ZIP for tests (uncompressed lumps). */
export function buildMinimalBizHawkSavestate(): Uint8Array {
  return zipSync({
    "BizState/BizState 1.0": new TextEncoder().encode("3\n"),
    "BizState/Core.bin": new Uint8Array([4, 0, 0, 0, 0]),
  });
}

/** Empty ZIP EOCD only — fails structural validation. */
export const INVALID_SAVE_ZIP = new Uint8Array([
  0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

/** Valid ZIP but missing BizHawk savestate lumps. */
export function buildNonBizHawkZip(): Uint8Array {
  return zipSync({ "not-a-save.txt": new Uint8Array([1]) });
}
