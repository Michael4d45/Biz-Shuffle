import type { ServerState } from "@bizshuffle-bun/protocol";
import { parseSaveUploadRejected } from "./save-upload.js";

export interface ClientApiPort {
  readonly baseUrl: string;
  getState(): Promise<ServerState>;
  getPlugins(): Promise<Record<string, unknown>>;
  uploadSave(instanceId: string, data: Buffer, filename?: string): Promise<void>;
}

export class ClientApi implements ClientApiPort {
  constructor(
    readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async getState(): Promise<ServerState> {
    const res = await this.fetchFn(`${this.baseUrl}/state.json`);
    if (!res.ok) throw new Error(`state.json: ${res.status}`);
    const body = (await res.json()) as { state: ServerState };
    return body.state;
  }

  async getPlugins(): Promise<Record<string, unknown>> {
    const res = await this.fetchFn(`${this.baseUrl}/api/plugins`);
    if (!res.ok) throw new Error(`api/plugins: ${res.status}`);
    const body = (await res.json()) as { plugins: Record<string, unknown> };
    return body.plugins ?? {};
  }

  async uploadSave(instanceId: string, data: Buffer, filename?: string): Promise<void> {
    const form = new FormData();
    const name = filename ?? `${instanceId}.state`;
    form.append("save", new Blob([new Uint8Array(data)]), name);
    form.append("filename", name);
    const res = await this.fetchFn(`${this.baseUrl}/save/upload`, { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const rejected = parseSaveUploadRejected(res.status, text);
      if (rejected) throw rejected;
      throw new Error(`save upload failed: ${res.status} ${text}`);
    }
  }
}
