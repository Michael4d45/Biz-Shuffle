import { join, resolve } from "node:path";
import { pathExists } from "./bun-io.js";

const JSON_LIMIT = 2 * 1024 * 1024;

export function text(body: string, status = 200, contentType = "text/plain"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function ok(body: unknown = "ok"): Response {
  return typeof body === "string" ? text(body) : json(body);
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > JSON_LIMIT) throw new HttpError(413, "body too large");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid json");
  }
}

export async function readUrlencodedBody(req: Request): Promise<Record<string, string>> {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function serveFile(filePath: string): Response | null {
  if (!pathExists(filePath)) return null;
  return new Response(Bun.file(filePath));
}

/** Serves a file under root; rejects path traversal. */
export function serveUnderRoot(root: string, urlPath: string): Response | null {
  const rel = decodeURIComponent(urlPath.replace(/^\/+/, ""));
  if (!rel || rel.includes("..")) return null;
  const filePath = resolve(join(root, rel));
  const rootResolved = resolve(root);
  if (!filePath.startsWith(rootResolved)) return null;
  return serveFile(filePath);
}
