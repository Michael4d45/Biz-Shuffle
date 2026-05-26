import type { ServerState } from "./types.js";

export function instancePlayerMap(state: ServerState | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!state?.players) return map;
  for (const [name, p] of Object.entries(state.players)) {
    if (p.instance_id) map.set(p.instance_id, name);
  }
  return map;
}

export function unassignedPlayers(state: ServerState | null): string[] {
  if (!state?.players) return [];
  const assignedNames = new Set(instancePlayerMap(state).values());
  return Object.keys(state.players).filter((name) => !assignedNames.has(name));
}

export function autofillInstanceId(
  gameFile: string,
  existingInstances: ReadonlyArray<{ id: string }>
): string {
  if (!gameFile) return "";
  const base = gameFile.replace(/\.[^/.]+$/, "");
  let clean = base.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  if (clean.length > 20) clean = clean.slice(0, 20);
  const ids = new Set(existingInstances.map((i) => i.id));
  if (!ids.has(clean)) return clean;
  let counter = 1;
  while (ids.has(`${clean}-${counter}`)) counter++;
  return `${clean}-${counter}`;
}
