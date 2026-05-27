import { describe, expect, it } from "bun:test";
import {
  BIZHAWK_DOWNLOAD_PROGRESS_CAP,
  VCREDIST_DOWNLOAD_PROGRESS_CAP,
  mapByteDownloadProgress,
  runEstimatedPhase,
} from "./install-progress.js";

describe("install-progress", () => {
  it("maps byte download percent into a capped overall range", () => {
    expect(mapByteDownloadProgress(0, BIZHAWK_DOWNLOAD_PROGRESS_CAP)).toBe(0);
    expect(mapByteDownloadProgress(100, BIZHAWK_DOWNLOAD_PROGRESS_CAP)).toBe(
      BIZHAWK_DOWNLOAD_PROGRESS_CAP - 1
    );
    expect(mapByteDownloadProgress(50, VCREDIST_DOWNLOAD_PROGRESS_CAP)).toBe(5);
  });

  it("advances through an estimated phase while work runs", async () => {
    const seen: number[] = [];
    await runEstimatedPhase(
      40,
      10,
      90,
      (pct) => seen.push(pct),
      async () => {
        await new Promise((r) => setTimeout(r, 25));
      }
    );
    expect(seen[0]).toBeGreaterThanOrEqual(10);
    expect(seen.at(-1)).toBe(90);
    expect(seen.length).toBeGreaterThan(1);
  });
});
