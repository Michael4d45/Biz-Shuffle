import { Updater, type UpdateStatusEntry } from "electrobun/bun";
import pkg from "../../package.json" with { type: "json" };
import type { AppUpdateState } from "../shared/rpc.js";
import { desktopLog } from "./log.js";

const DEV_FALLBACK_VERSION = pkg.version;

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

function stateFromUpdaterCheck(result: {
  version: string;
  hash: string;
  updateAvailable: boolean;
  updateReady: boolean;
  error: string;
}): Partial<AppUpdateState> {
  const cached = Updater.updateInfo();
  return {
    latestVersion: result.version || cached?.version || undefined,
    updateAvailable: result.updateAvailable,
    updateReady: cached?.updateReady ?? result.updateReady,
    error: result.error || undefined,
  };
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
  const version = local.version || DEV_FALLBACK_VERSION;
  const channel = local.channel || "dev";
  const updatesEnabled = channel !== "dev" && Boolean(local.baseUrl?.trim());
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
    desktopLog(
      "bizshuffle-bun",
      `update check: available=${result.updateAvailable} ready=${result.updateReady} err=${result.error}`
    );
    return pushState({
      ...stateFromUpdaterCheck(result),
      downloading: false,
    });
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
