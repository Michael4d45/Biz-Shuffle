export const LUA_RECONNECT_DELAYS_MS = [1000, 3000, 5000] as const;
export const ROM_DOWNLOAD_RETRIES = 3;
export const ROM_DOWNLOAD_BACKOFF_MS = 500;

export function luaReconnectDelayMs(attempt: number): number {
  return LUA_RECONNECT_DELAYS_MS[Math.min(attempt, LUA_RECONNECT_DELAYS_MS.length - 1)] ?? 5000;
}

export function romRetryDelayMs(attempt: number): number {
  return ROM_DOWNLOAD_BACKOFF_MS * 2 ** attempt;
}
