import type { DependencyId, DependencyStatus } from "@bizshuffle-bun/client-host";
import type { ElectrobunRPCSchema } from "electrobun/bun";

export type DiscoveredServerEntry = {
  label: string;
  url: string;
  isHosted: boolean;
};

/** Persisted shell form fields ({dataDir}/settings.json). */
export type ShellSettings = {
  bindHost: string;
  /** TCP port for Host; 0 = pick a free port. */
  hostPort: number;
  serverUrl: string;
  playerName: string;
};

/** One row in the shell dependencies panel (BizHawk, VC++ runtime, …). */
export type DependencyUiItem = {
  id: DependencyId;
  label: string;
  status: DependencyStatus;
  detail: string;
  actionLabel?: string;
  installing: boolean;
  /** 0–100 while installing; -1 when idle. */
  progress: number;
  statusMessage?: string;
  error?: string;
};

export type DependenciesState = {
  checking: boolean;
  items: DependencyUiItem[];
  playBlocked: boolean;
};

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
      host: {
        params: { bindHost?: string; hostPort?: number };
        response: { url: string; bindHost: string; hostPort: number };
      };
      join: { params: { serverUrl: string; playerName: string }; response: { ok: boolean } };
      discover: {
        params: Record<string, never>;
        response: { hostedUrl: string | null; servers: DiscoveredServerEntry[] };
      };
      getShellSettings: { params: Record<string, never>; response: ShellSettings };
      saveShellSettings: { params: Partial<ShellSettings>; response: ShellSettings };
      getDataDir: { params: Record<string, never>; response: string };
      openFolder: { params: { subpath?: string }; response: void };
      getAppInfo: { params: Record<string, never>; response: AppUpdateState };
      checkForUpdates: { params: Record<string, never>; response: AppUpdateState };
      installUpdate: { params: Record<string, never>; response: void };
      getDependencies: { params: Record<string, never>; response: DependenciesState };
      installDependency: {
        params: { id: DependencyId };
        response: DependenciesState;
      };
      installAllDependencies: {
        params: Record<string, never>;
        response: DependenciesState;
      };
      /** Round-trip boot handshake — webview must await before other RPC calls. */
      shellReady: { params: Record<string, never>; response: { ok: true } };
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
      /** Bun → webview dependencies panel (BizHawk, VC++ …). */
      dependenciesState: DependenciesState;
    };
  };
} & ElectrobunRPCSchema;
