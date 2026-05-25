import type { ServerState } from "./types.js";

export async function fetchState(): Promise<ServerState> {
  const res = await fetch("/state.json");
  if (!res.ok) throw new Error(`state.json ${res.status}`);
  const body = (await res.json()) as { state: ServerState };
  return body.state;
}

export async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function postForm(path: string, form: FormData): Promise<Response> {
  return fetch(path, { method: "POST", body: form });
}

export async function del(path: string): Promise<Response> {
  return fetch(path, { method: "DELETE" });
}

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}
