import { Effect, Schedule } from "effect";

export const LUA_RECONNECT_DELAYS_MS = [1000, 3000, 5000] as const;
export const ROM_DOWNLOAD_RETRIES = 3;
export const ROM_DOWNLOAD_BACKOFF_MS = 500;

export function romRetryDelay(attempt: number): number {
  return ROM_DOWNLOAD_BACKOFF_MS * Math.pow(2, attempt);
}

export function luaReconnectDelayMs(attempt: number): number {
  return LUA_RECONNECT_DELAYS_MS[Math.min(attempt, LUA_RECONNECT_DELAYS_MS.length - 1)] ?? 5000;
}

export const luaReconnectSchedule = Schedule.recurs(LUA_RECONNECT_DELAYS_MS.length).pipe(
  Schedule.addDelay(() => "1 second")
);

export async function retryAsync<T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs: (attempt: number) => number
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs(i)));
    }
  }
  throw last;
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: unknown[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

export function retryEffect<A, E>(
  effect: Effect.Effect<A, E>,
  schedule: Schedule.Schedule<unknown, unknown, never>
): Effect.Effect<A, E> {
  return Effect.retry(effect, schedule);
}
