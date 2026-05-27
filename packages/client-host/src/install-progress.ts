/** BizHawk zip extract — progress bar estimate when bytes are not available. */
export const BIZHAWK_EXTRACT_ESTIMATE_MS = 15_000;

/** VC++ silent install — progress bar estimate (download is much shorter). */
export const VCREDIST_INSTALL_ESTIMATE_MS = 5 * 60_000;

/** Max overall progress (0–100) while downloading BizHawk; remainder is extract. */
export const BIZHAWK_DOWNLOAD_PROGRESS_CAP = 85;

/** Max overall progress while downloading VC++ redist; remainder is install. */
export const VCREDIST_DOWNLOAD_PROGRESS_CAP = 10;

export function mapByteDownloadProgress(downloadPct: number, cap: number): number {
  const clamped = Math.max(0, Math.min(100, downloadPct));
  return Math.min(Math.max(0, cap - 1), Math.round((clamped / 100) * cap));
}

/**
 * Advance progress from startPct toward endPct over estimateMs while work runs.
 * Clears the timer when work finishes (even if early or late vs estimate).
 */
export async function runEstimatedPhase(
  estimateMs: number,
  startPct: number,
  endPct: number,
  onPct: (pct: number) => void,
  work: () => Promise<void>
): Promise<void> {
  const start = Date.now();
  const tick = (): void => {
    const elapsed = Date.now() - start;
    const t = estimateMs > 0 ? Math.min(1, elapsed / estimateMs) : 1;
    onPct(Math.round(startPct + t * (endPct - startPct)));
  };
  tick();
  const timer = setInterval(tick, 500);
  try {
    await work();
  } finally {
    clearInterval(timer);
  }
  onPct(endPct);
}
