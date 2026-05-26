import type { DiscoveryMessage } from "@bizshuffle-bun/protocol";
import type { ElectrobunRPCSchema } from "electrobun/bun";

/** Desktop app version + Electrobun updater state pushed to the shell footer. */
export type AppUpdateState = {
  version: string;
  channel: string;
  updatesEnabled: boolean;
  latestVersion?: string;
  updateAvailable: boolean;
  updateReady: boolean;
  downloading: boolean;
  status?: string;
  error?: string;
};

/** Shell ↔ Bun RPC (no admin HTTP APIs). */
export type ShellRPCSchema = {
  bun: {
    requests: {
      host: { params: Record<string, never>; response: { url: string } };
      join: { params: { serverUrl: string; playerName: string }; response: { ok: boolean } };
      hostAndPlay: { params: { playerName: string }; response: { url: string } };
      discover: { params: Record<string, never>; response: DiscoveryMessage[] };
      getDataDir: { params: Record<string, never>; response: string };
      openFolder: { params: { subpath?: string }; response: void };
      getAppInfo: { params: Record<string, never>; response: AppUpdateState };
      checkForUpdates: { params: Record<string, never>; response: AppUpdateState };
      installUpdate: { params: Record<string, never>; response: void };
    };
    messages: {
      /** Webview → bun diagnostic lines (smoke tests, dev logging). */
      diag: { line: string };
    };
  };
  webview: {
    requests: Record<never, never>;
    messages: {
      /** Bun → webview status line. */
      status: { msg: string };
      /** Bun → webview footer version / update UI. */
      updateState: AppUpdateState;
    };
  };
} & ElectrobunRPCSchema;
