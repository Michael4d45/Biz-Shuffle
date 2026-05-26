import { Updater, type UpdateStatusEntry } from "electrobun/bun";
import pkg from "../../package.json" with { type: "json" };
import type { AppUpdateState } from "../shared/rpc.js";
import { desktopLog } from "./log.js";

const DEV_FALLBACK_VERSION = pkg.version;

function formatVersion(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return DEV_FALLBACK_VERSION?.trim() || "0.0.0";
}

type SendUpdateState = (state: AppUpdateState) => void;

let sendState: SendUpdateState | null = null;

let currentState: AppUpdateState = {
  version: DEV_FALLBACK_VERSION,
  channel: "dev",
  updatesEnabled: false,
  updateAvailable: false,
  updateReady: false,
  downloading: false,
};

function pushState(patch: Partial<AppUpdateState>): AppUpdateState {
  currentState = { ...currentState, ...patch };
  sendState?.(currentState);
  return currentState;
}

function stateFromUpdaterCheck(
  result: {
    version: string;
    hash: string;
    updateAvailable: boolean;
    updateReady: boolean;
    error: string;
  },
  localVersion: string
): Partial<AppUpdateState> {
  const cached = Updater.updateInfo();
  const remoteVersion = result.version?.trim() || cached?.version?.trim() || undefined;
  const updateAvailable = Boolean(result.updateAvailable);
  // Electrobun may return the local version when no update; don't label that as "latest".
  const latestVersion =
    updateAvailable && remoteVersion && remoteVersion !== localVersion ? remoteVersion : undefined;
  return {
    latestVersion,
    updateAvailable,
    updateReady: Boolean(cached?.updateReady ?? result.updateReady),
    error: result.error?.trim() || undefined,
  };
}

/** Re-push cached updater state after the shell webview connects (init may run too early). */
export function notifyAppUpdateState(): void {
  sendState?.(currentState);
}

export function setAppUpdateSender(fn: SendUpdateState): void {
  sendState = fn;
}

export function startAppUpdateStatusListener(): void {
  Updater.onStatusChange((entry: UpdateStatusEntry) => {
    const progress = entry.details?.progress;
    if (entry.status === "download-progress" && progress != null) {
      pushState({
        downloading: true,
        status: `Downloading… ${Math.round(progress * 100)}%`,
      });
      return;
    }
    if (
      entry.status === "downloading" ||
      entry.status === "downloading-patch" ||
      entry.status === "downloading-full-bundle" ||
      entry.status === "decompressing" ||
      entry.status === "applying-patch"
    ) {
      pushState({ downloading: true, status: entry.message });
      return;
    }
    if (entry.status === "download-complete" || entry.status === "complete") {
      const cached = Updater.updateInfo();
      pushState({
        downloading: false,
        updateReady: cached?.updateReady ?? false,
        status: entry.message,
      });
    }
  });
}

export async function getAppInfo(): Promise<AppUpdateState> {
  const local = await Updater.getLocalInfo();
  const version = formatVersion(local.version);
  const channel = typeof local.channel === "string" ? local.channel : "dev";
  const updatesEnabled = channel !== "dev" && Boolean(local.baseUrl?.trim());
  desktopLog(
    "bizshuffle-bun",
    `app info: version=${version} channel=${channel} updatesEnabled=${updatesEnabled}`
  );
  return pushState({
    version,
    channel,
    updatesEnabled,
    error: undefined,
  });
}

export async function checkForUpdates(): Promise<AppUpdateState> {
  const info = await getAppInfo();
  if (!info.updatesEnabled) {
    return pushState({
      updateAvailable: false,
      updateReady: false,
      downloading: false,
    });
  }
  try {
    const result = await Updater.checkForUpdate();
    const remoteVersion =
      result.version?.trim() || Updater.updateInfo()?.version?.trim() || undefined;
    const patch = stateFromUpdaterCheck(result, info.version);
    desktopLog(
      "bizshuffle-bun",
      `update check: local=${info.version} remote=${remoteVersion ?? "(unknown)"} available=${patch.updateAvailable} ready=${patch.updateReady} err=${patch.error ?? ""}`
    );
    return pushState({ ...patch, downloading: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    desktopLog("bizshuffle-bun", `update check failed: ${msg}`);
    return pushState({ error: msg, downloading: false });
  }
}

export async function installUpdate(): Promise<void> {
  const info = await getAppInfo();
  if (!info.updatesEnabled) {
    throw new Error("Updates are not available in dev builds");
  }

  const cached = Updater.updateInfo();
  if (cached?.updateReady) {
    desktopLog("bizshuffle-bun", "applying prepared update");
    await Updater.applyUpdate();
    return;
  }

  pushState({ downloading: true, status: "Downloading update…", error: undefined });
  try {
    await Updater.downloadUpdate();
    const after = Updater.updateInfo();
    pushState({
      downloading: false,
      updateAvailable: after?.updateAvailable ?? true,
      updateReady: after?.updateReady ?? false,
      latestVersion: after?.version || currentState.latestVersion,
      status: after?.updateReady ? "Restart to apply update" : undefined,
    });
    if (after?.updateReady) {
      desktopLog("bizshuffle-bun", "update downloaded, ready to apply");
      await Updater.applyUpdate();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    desktopLog("bizshuffle-bun", `update install failed: ${msg}`);
    pushState({ downloading: false, error: msg, status: undefined });
    throw err;
  }
}

export function initAppUpdates(): void {
  startAppUpdateStatusListener();
  void (async () => {
    await getAppInfo();
    await checkForUpdates();
  })();
}
