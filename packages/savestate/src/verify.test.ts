import { describe, expect, it } from "bun:test";
import { buildMinimalBizHawkSavestate, INVALID_SAVE_ZIP } from "./fixture.js";
import { isProbablyBizHawkSavestate, verifyBizHawkSavestate } from "./verify.js";

describe("verifyBizHawkSavestate", () => {
  it("accepts minimal valid savestate", () => {
    const bytes = buildMinimalBizHawkSavestate();
    expect(isProbablyBizHawkSavestate(bytes)).toBe(true);
    const result = verifyBizHawkSavestate(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.formatVersion).toBe("1.0.3");
      expect(result.zipSubVersion).toBe(3);
    }
  });

  it("rejects empty zip stub", () => {
    expect(isProbablyBizHawkSavestate(INVALID_SAVE_ZIP)).toBe(false);
    const result = verifyBizHawkSavestate(INVALID_SAVE_ZIP);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NOT_ZIP_SAVESTATE");
    }
  });

  it("rejects non-zip bytes", () => {
    const result = verifyBizHawkSavestate(new Uint8Array([1, 2, 3, 4]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_ZIP_SAVESTATE");
  });
});
