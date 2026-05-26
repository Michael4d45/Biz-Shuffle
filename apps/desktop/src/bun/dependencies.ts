import {
  type DependencyId,
  dependenciesPlayBlockedMessage,
  getDependenciesSnapshot,
  installVCRedist,
  upgradeBizHawk,
} from "@bizshuffle-bun/client-host";
import type { DependenciesState, DependencyUiItem } from "../shared/rpc.js";
import { desktopLog } from "./log.js";

type SendDependencies = (state: DependenciesState) => void;

let sendState: SendDependencies | null = null;
let currentState: DependenciesState = { checking: true, items: [], playBlocked: true };
const installing = new Set<DependencyId>();

function pushState(patch: Partial<DependenciesState>): DependenciesState {
  currentState = { ...currentState, ...patch };
  sendState?.(currentState);
  return currentState;
}

function patchItem(id: DependencyId, patch: Partial<DependencyUiItem>): void {
  pushState({
    items: currentState.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  });
}

export function setDependenciesSender(fn: SendDependencies): void {
  sendState = fn;
}

export function refreshDependencies(dataDir: string): DependenciesState {
  const snap = getDependenciesSnapshot(dataDir);
  const items: DependencyUiItem[] = snap.items.map((item) => {
    const prev = currentState.items.find((i) => i.id === item.id);
    const isInstalling = installing.has(item.id);
    return {
      ...item,
      installing: isInstalling,
      progress: isInstalling ? (prev?.progress ?? 0) : -1,
      statusMessage: isInstalling ? prev?.statusMessage : undefined,
      error: isInstalling ? prev?.error : undefined,
    };
  });
  return pushState({ checking: false, items, playBlocked: snap.playBlocked });
}

export function initDependencies(dataDir: string): void {
  pushState({ checking: true, items: [], playBlocked: true });
  refreshDependencies(dataDir);
}

export function playBlockedReason(dataDir: string): string | null {
  const snap = getDependenciesSnapshot(dataDir);
  return snap.playBlocked ? dependenciesPlayBlockedMessage(snap) : null;
}

function logDependencyProgress(id: DependencyId, msg: string, pct?: number): void {
  // Milestones only — per-chunk progress would flood desktop-smoke.log.
  if (pct != null && pct !== 0 && pct < 100) return;
  desktopLog("bizshuffle-bun", `[${id}] ${msg}`);
}

export async function installDependency(
  dataDir: string,
  id: DependencyId,
  log?: (msg: string) => void
): Promise<DependenciesState> {
  if (installing.has(id)) return currentState;
  installing.add(id);
  refreshDependencies(dataDir);
  patchItem(id, { installing: true, progress: 0, statusMessage: "Starting…", error: undefined });

  try {
    if (id === "bizhawk") {
      await upgradeBizHawk(dataDir, (msg, pct) => {
        patchItem(id, {
          statusMessage: msg,
          progress: pct ?? currentState.items.find((i) => i.id === id)?.progress ?? 0,
        });
        if (pct == null || pct === 0 || pct >= 100) {
          log?.(msg);
          logDependencyProgress(id, msg, pct);
        }
      });
    } else if (id === "vcredist") {
      await installVCRedist((pct, msg) => {
        patchItem(id, { statusMessage: msg, progress: pct });
        if (pct === 0 || pct >= 100) {
          log?.(msg);
          logDependencyProgress(id, msg, pct);
        }
      });
    }
    installing.delete(id);
    return refreshDependencies(dataDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    desktopLog("bizshuffle-bun", `${id} install failed: ${msg}`);
    installing.delete(id);
    patchItem(id, { installing: false, progress: -1, error: msg, statusMessage: undefined });
    refreshDependencies(dataDir);
    throw err;
  }
}
