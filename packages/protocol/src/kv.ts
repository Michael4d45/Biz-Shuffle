export function parseKv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    result[key] = value;
  }
  return result;
}

export function writeKv(
  entries: Record<string, string>,
  options?: { statusFirst?: boolean }
): string {
  const keys = Object.keys(entries);
  if (options?.statusFirst && entries.status) {
    const rest = keys.filter((k) => k !== "status").sort();
    return ["status=" + entries.status, ...rest.map((k) => `${k}=${entries[k]}`)].join("\n") + "\n";
  }
  return (
    keys
      .sort()
      .map((k) => `${k}=${entries[k]}`)
      .join("\n") + "\n"
  );
}

export function migratePluginStatus(meta: Record<string, string>): Record<string, string> {
  const settings: Record<string, string> = { status: meta.status ?? "disabled" };
  for (const [k, v] of Object.entries(meta)) {
    if (k !== "status") settings[k] = v;
  }
  return settings;
}
