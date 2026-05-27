/** Map caught errors to user-facing status text (Host / Join / install actions). */
export function formatShellError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const trimmed = msg.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/^Error:\s*/, "");
}
