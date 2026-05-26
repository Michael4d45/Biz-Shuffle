import { getBizHawkStatus } from "./bizhawk-setup.js";
import { SUPPORTED_BIZHAWK_VERSION } from "./bizhawk-version.js";
import { getVCRedistStatus } from "./vcredist-setup.js";

export type DependencyId = "bizhawk" | "vcredist";

export type DependencyStatus = "checking" | "ok" | "missing" | "outdated" | "error";

export type DependencyItem = {
  id: DependencyId;
  label: string;
  status: DependencyStatus;
  detail: string;
  actionLabel?: string;
};

export type DependenciesSnapshot = {
  checking: boolean;
  /** Only items that need user action (panel hidden when empty). */
  items: DependencyItem[];
  playBlocked: boolean;
};

export function getDependenciesSnapshot(dataDir: string): DependenciesSnapshot {
  const items: DependencyItem[] = [];

  const bizhawk = getBizHawkStatus(dataDir);
  if (bizhawk.missing) {
    items.push({
      id: "bizhawk",
      label: "BizHawk",
      status: "missing",
      detail: `Not found — ${SUPPORTED_BIZHAWK_VERSION} required`,
      actionLabel: `Install BizHawk ${SUPPORTED_BIZHAWK_VERSION}`,
    });
  } else if (bizhawk.needsUpdate) {
    const installed = bizhawk.installedVersion ?? "unknown";
    items.push({
      id: "bizhawk",
      label: "BizHawk",
      status: "outdated",
      detail: `v${installed} installed — v${SUPPORTED_BIZHAWK_VERSION} or newer required`,
      actionLabel: `Update to ${SUPPORTED_BIZHAWK_VERSION}`,
    });
  }

  const vc = getVCRedistStatus();
  if (vc.required && !vc.installed) {
    items.push({
      id: "vcredist",
      label: "Visual C++ runtime",
      status: "missing",
      detail: "Required for BizHawk on Windows",
      actionLabel: "Install VC++ runtime",
    });
  }

  return { checking: false, items, playBlocked: items.length > 0 };
}

export function dependenciesPlayBlockedMessage(snapshot: DependenciesSnapshot): string {
  const bizhawk = snapshot.items.find((i) => i.id === "bizhawk");
  const vc = snapshot.items.find((i) => i.id === "vcredist");
  if (bizhawk?.status === "outdated") {
    return `Update BizHawk using the button above (${bizhawk.detail}).`;
  }
  if (bizhawk?.status === "missing") {
    return "Install BizHawk using the button above before joining or playing.";
  }
  if (vc?.status === "missing") {
    return "Install the Visual C++ runtime using the button above before joining or playing.";
  }
  return "Resolve dependencies above before joining or playing.";
}
