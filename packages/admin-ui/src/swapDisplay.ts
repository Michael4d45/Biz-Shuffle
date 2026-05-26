import type { ServerState } from "./types.js";

export function nextSwapDisplay(state: ServerState | null, nowMs = Date.now()): string {
  if (!state?.next_swap_at) return "—";
  const sec = Math.max(0, Math.floor(state.next_swap_at - nowMs / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function swapProgress(state: ServerState | null, nowMs = Date.now()): number {
  if (!state?.next_swap_at || !state.min_interval_secs) return 0;
  const total = (state.max_interval_secs ?? state.min_interval_secs) || 300;
  const remaining = Math.max(0, state.next_swap_at - nowMs / 1000);
  return Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
}

export function swapTimerActive(state: ServerState | null): boolean {
  return Boolean(state?.running && state.next_swap_at && state.min_interval_secs);
}
