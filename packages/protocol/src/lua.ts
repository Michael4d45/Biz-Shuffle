import type { LuaCmd, LuaCommand } from "./schemas.js";

function splitUnescaped(s: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      cur += s[i + 1];
      i++;
      continue;
    }
    if (s[i] === sep) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += s[i];
  }
  parts.push(cur);
  return parts;
}

function parsePayload(payload: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const tokens = splitUnescaped(payload, ";");
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq === -1) continue;
    const key = tok.slice(0, eq);
    const val = tok.slice(eq + 1);
    fields[key] = val;
  }
  return fields;
}

export function parseLuaCommand(line: string): LuaCommand {
  const s = line.trim();
  if (!s) throw new Error("empty line");
  const parts = splitUnescaped(s, "|");
  if (parts.length < 2 || parts[0] !== "CMD") {
    throw new Error(`invalid CMD format: ${line}`);
  }
  let i = 1;
  const maybeId = parts[i];
  if (/^\d+$/.test(maybeId ?? "") && parts.length > 2) {
    i++;
  }
  const kind = (parts[i] ?? "").toLowerCase() as LuaCmd;
  if (!["swap", "swap_me", "message"].includes(kind)) {
    throw new Error(`unknown lua kind: ${kind}`);
  }
  i++;
  const fields: Record<string, string> = {};
  if (i < parts.length) {
    const payload = parts.slice(i).join("|");
    Object.assign(fields, parsePayload(payload));
  }
  return { Raw: line, Kind: kind, Fields: fields };
}
