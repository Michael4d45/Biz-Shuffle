import { Electroview } from "electrobun/view";
import type {
  AppUpdateState,
  DependenciesState,
  ShellRPCSchema,
  ShellSettings,
} from "../../shared/rpc.js";

const defaultDepsState: DependenciesState = {
  checking: true,
  items: [],
  playBlocked: true,
};

const defaultUpdateState: AppUpdateState = {
  version: "…",
  channel: "dev",
  updatesEnabled: false,
  updateAvailable: false,
  updateReady: false,
  downloading: false,
};

let updateState: AppUpdateState = { ...defaultUpdateState };
let depsState: DependenciesState = { ...defaultDepsState };

const rpc = Electroview.defineRPC<ShellRPCSchema>({
  maxRequestTime: 60_000,
  handlers: {
    requests: {},
    messages: {
      status: ({ msg }) => {
        const el = document.getElementById("status");
        if (el) el.textContent = msg;
      },
      updateState: (state) => {
        updateState = state;
        patchFooter();
      },
      dependenciesState: (state) => {
        depsState = state;
        syncDepsUi();
      },
    },
  },
});

function slog(msg: string): void {
  const line = `[bizshuffle-shell] ${msg}`;
  console.log(line);
  try {
    rpc.send.diag({ line: msg });
  } catch {
    /* transport not ready */
  }
}

slog("view script loaded");
new Electroview({ rpc });
slog("Electroview constructed");

const DEFAULT_BIND_HOST = "127.0.0.1";

let busy = false;
let view: "welcome" | "join" = "welcome";
let serverUrl = "http://127.0.0.1:8080";
let playerName = "";
let bindHost = DEFAULT_BIND_HOST;
let statusLine = "";
let discovered: { label: string; url: string; isHosted: boolean }[] = [];
let saveSettingsTimer: ReturnType<typeof setTimeout> | null = null;
let settingsLoaded = false;

const root = document.getElementById("root");
if (!root) {
  slog("FATAL: #root missing from DOM");
} else {
  slog(`#root found, initial children=${root.childElementCount}`);
}

function setStatus(msg: string): void {
  statusLine = msg;
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

/** Read live input values before replacing the DOM (module vars lag behind typing). */
function captureFormState(): void {
  const serverUrlEl = document.getElementById("server-url") as HTMLInputElement | null;
  if (serverUrlEl) serverUrl = serverUrlEl.value;
  const playerNameEl = document.getElementById("player-name") as HTMLInputElement | null;
  if (playerNameEl) playerName = playerNameEl.value;
  const bindHostEl = document.getElementById("bind-host") as HTMLInputElement | null;
  if (bindHostEl) bindHost = bindHostEl.value;
}

function applySettings(settings: ShellSettings): void {
  bindHost = settings.bindHost || DEFAULT_BIND_HOST;
  serverUrl = settings.serverUrl || serverUrl;
  playerName = settings.playerName;
}

function currentSettingsPatch(): Partial<ShellSettings> {
  captureFormState();
  return { bindHost, serverUrl, playerName };
}

async function persistShellSettings(): Promise<void> {
  if (!settingsLoaded) return;
  try {
    await rpc.request.saveShellSettings(currentSettingsPatch());
  } catch (e) {
    slog(`saveShellSettings failed: ${e}`);
  }
}

function schedulePersistShellSettings(): void {
  if (!settingsLoaded) return;
  if (saveSettingsTimer) clearTimeout(saveSettingsTimer);
  saveSettingsTimer = setTimeout(() => {
    saveSettingsTimer = null;
    void persistShellSettings();
  }, 400);
}

async function loadShellSettingsFromDisk(): Promise<void> {
  try {
    const settings = await rpc.request.getShellSettings({});
    applySettings(settings);
    settingsLoaded = true;
    render();
  } catch (e) {
    slog(`getShellSettings failed: ${e}`);
    settingsLoaded = true;
  }
}

type SavedFocus = { id: string; start: number | null; end: number | null };

function saveFocus(): SavedFocus | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement) || !el.id) return null;
  return { id: el.id, start: el.selectionStart, end: el.selectionEnd };
}

function restoreFocus(saved: SavedFocus | null): void {
  if (!saved) return;
  const el = document.getElementById(saved.id);
  if (!(el instanceof HTMLInputElement)) return;
  el.focus();
  if (saved.start !== null && saved.end !== null) {
    el.setSelectionRange(saved.start, saved.end);
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function depsPanelHtml(): string {
  if (depsState.checking) {
    return `<section class="deps-panel" id="deps-panel"><p class="deps-checking">Checking dependencies…</p></section>`;
  }

  if (depsState.items.length === 0) {
    return "";
  }

  const rows = depsState.items
    .map((item) => {
      const statusClass =
        item.status === "ok" ? "deps-ok" : item.installing ? "deps-installing" : "deps-action";
      const showAction = item.actionLabel && item.status !== "ok" && !item.installing;
      const progress =
        item.installing && item.progress >= 0
          ? `<div class="deps-progress" role="progressbar" aria-valuenow="${item.progress}" aria-valuemin="0" aria-valuemax="100"><div class="deps-progress-bar" style="width:${item.progress}%"></div></div><p class="deps-progress-msg">${escapeHtml(item.statusMessage ?? "")}</p>`
          : "";
      const err = item.error ? `<p class="deps-error">${escapeHtml(item.error)}</p>` : "";
      const btn = showAction
        ? `<button type="button" class="deps-action-btn" data-dep-id="${item.id}">${escapeHtml(item.actionLabel!)}</button>`
        : "";
      return `<div class="deps-row ${statusClass}" data-dep-id="${item.id}">
        <div class="deps-row-head"><strong>${escapeHtml(item.label)}</strong><span class="deps-detail">${escapeHtml(item.detail)}</span></div>
        ${progress}${err}${btn}
      </div>`;
    })
    .join("");

  const blocked =
    depsState.playBlocked && !depsState.items.some((i) => i.installing)
      ? `<p class="deps-hint">Install or update the items above before joining.</p>`
      : "";

  return `<section class="deps-panel" id="deps-panel">${rows}${blocked}</section>`;
}

function footerHtml(): string {
  const { version, channel, updateAvailable, updateReady, downloading, latestVersion, status } =
    updateState;
  const devSuffix = channel === "dev" ? " (dev)" : "";
  const versionLabel =
    updateAvailable && latestVersion && !updateReady
      ? `v${escapeHtml(version)} → v${escapeHtml(latestVersion)}`
      : `v${escapeHtml(version)}${devSuffix}`;

  let updateBtn = "";
  if (updateAvailable || updateReady) {
    const label = updateReady
      ? "Restart to update"
      : downloading
        ? escapeHtml(status || "Downloading…")
        : latestVersion
          ? `Update to v${escapeHtml(latestVersion)}`
          : "Update available";
    const disabled = downloading && !updateReady ? "disabled" : "";
    updateBtn = `<button type="button" class="link update-btn" id="update-btn" ${disabled}>${label}</button>`;
  }

  return `<footer class="app-footer"><div class="footer-row"><span class="app-version">${versionLabel}</span>${updateBtn}</div></footer>`;
}

function wireDepsPanel(): void {
  document.querySelectorAll(".deps-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLButtonElement).dataset.depId as "bizhawk" | "vcredist";
      void (async () => {
        try {
          depsState = await rpc.request.installDependency({ id });
          syncDepsUi();
        } catch (e) {
          setStatus(String(e));
        }
      })();
    });
  });
}

function wireFooterButtons(): void {
  document.getElementById("update-btn")?.addEventListener("click", () => {
    if (updateState.downloading && !updateState.updateReady) return;
    void (async () => {
      try {
        await rpc.request.installUpdate({});
      } catch (e) {
        setStatus(String(e));
      }
    })();
  });
}

function syncDepsUi(): void {
  const html = depsPanelHtml();
  const panel = document.getElementById("deps-panel");
  if (!html) {
    panel?.remove();
    render();
    return;
  }
  if (panel) {
    panel.outerHTML = html;
    wireDepsPanel();
    updatePlayButtons();
    return;
  }
  render();
}

function patchDepsPanel(): void {
  syncDepsUi();
}

function patchFooter(): void {
  const footer = document.querySelector(".app-footer");
  if (!footer) return;
  footer.outerHTML = footerHtml();
  wireFooterButtons();
}

function updatePlayButtons(): void {
  const blocked = depsState.playBlocked || depsState.checking;
  const goJoin = document.getElementById("go-join") as HTMLButtonElement | null;
  if (goJoin) goJoin.disabled = blocked || busy;
  const joinSubmit = document.querySelector(
    ".join-form button[type=submit]"
  ) as HTMLButtonElement | null;
  if (joinSubmit) joinSubmit.disabled = blocked || busy;
}

function playBlockedClientMessage(): string | null {
  if (depsState.checking) return "Still checking dependencies…";
  if (!depsState.playBlocked) return null;
  const bizhawk = depsState.items.find((i) => i.id === "bizhawk");
  const vc = depsState.items.find((i) => i.id === "vcredist");
  if (bizhawk?.status === "outdated") {
    return `BizHawk needs an update — use "${bizhawk.actionLabel ?? "Update"}" above.`;
  }
  if (bizhawk?.status === "missing") {
    return `BizHawk is required — use "${bizhawk.actionLabel ?? "Install"}" above.`;
  }
  if (vc?.status === "missing") {
    return `Visual C++ runtime is required — use "${vc.actionLabel ?? "Install"}" above.`;
  }
  return "Resolve dependencies above before joining or playing.";
}

async function loadDependencies(): Promise<void> {
  try {
    depsState = await rpc.request.getDependencies({});
    patchDepsPanel();
  } catch (e) {
    slog(`getDependencies failed: ${e}`);
  }
}

async function loadAppInfo(): Promise<void> {
  try {
    updateState = await rpc.request.getAppInfo({});
    patchFooter();
  } catch (e) {
    slog(`getAppInfo failed: ${e}`);
  }
}

function discoveredServersHtml(selectable: boolean, onWelcome = false): string {
  if (discovered.length === 0) {
    return `<p class="discovered-empty">No servers discovered yet. Use a server URL below or refresh.</p>`;
  }
  const items = discovered
    .map((d) => {
      const hosted = d.isHosted ? ' <span class="hosted-badge">(hosting)</span>' : "";
      if (selectable) {
        const pickClass = onWelcome ? "link pick-server-welcome" : "link pick-server";
        return `<li><button type="button" class="${pickClass}" data-url="${escapeHtml(d.url)}">${escapeHtml(d.label)} (${escapeHtml(d.url)})${hosted}</button></li>`;
      }
      return `<li>${escapeHtml(d.label)} (${escapeHtml(d.url)})${hosted}</li>`;
    })
    .join("");
  return `<div class="discovered"><span>Servers on LAN:</span><ul>${items}</ul></div>`;
}

function wirePickServerButtons(): void {
  document.querySelectorAll(".pick-server").forEach((btn) => {
    btn.addEventListener("click", () => {
      serverUrl = (btn as HTMLButtonElement).dataset.url ?? serverUrl;
      const input = document.getElementById("server-url") as HTMLInputElement | null;
      if (input) input.value = serverUrl;
      else render();
      schedulePersistShellSettings();
    });
  });
  document.querySelectorAll(".pick-server-welcome").forEach((btn) => {
    btn.addEventListener("click", () => {
      serverUrl = (btn as HTMLButtonElement).dataset.url ?? serverUrl;
      schedulePersistShellSettings();
      view = "join";
      render();
    });
  });
}

function patchDiscoveredServers(): void {
  const container = document.getElementById("discovered-servers");
  if (!container) return;
  container.innerHTML = discoveredServersHtml(true, view === "welcome");
  wirePickServerButtons();
}

async function refreshDiscovery(userInitiated = false): Promise<void> {
  try {
    const { servers, hostedUrl: hosted } = await rpc.request.discover({});
    discovered = servers;
    captureFormState();
    if (!serverUrl && hosted) serverUrl = hosted;
    if (document.getElementById("discovered-servers")) {
      patchDiscoveredServers();
      const serverUrlEl = document.getElementById("server-url") as HTMLInputElement | null;
      if (serverUrlEl && serverUrl) serverUrlEl.value = serverUrl;
      return;
    }
    render();
  } catch (e) {
    slog(`discover failed: ${e}`);
    if (userInitiated) {
      setStatus("Could not refresh server list — try again in a moment.");
    }
  }
}

function wireJoinFormInputs(): void {
  document.getElementById("server-url")?.addEventListener("input", (e) => {
    serverUrl = (e.target as HTMLInputElement).value;
    schedulePersistShellSettings();
  });
  document.getElementById("player-name")?.addEventListener("input", (e) => {
    playerName = (e.target as HTMLInputElement).value;
    schedulePersistShellSettings();
  });
}

function wireBindHostInput(): void {
  document.getElementById("bind-host")?.addEventListener("input", (e) => {
    bindHost = (e.target as HTMLInputElement).value;
    schedulePersistShellSettings();
  });
}

function render(): void {
  if (!root) {
    slog("render skipped — no #root");
    return;
  }
  captureFormState();
  const savedFocus = saveFocus();
  slog(`render:${view}`);
  const deps = depsPanelHtml();
  const footer = footerHtml();

  if (view === "join") {
    root.innerHTML = `
      <div class="shell">
        <header>
          <button type="button" class="link" id="back">← Back</button>
          <h1>Join session</h1>
        </header>
        ${deps}
        <form class="join-form" id="join-form">
          <label>Server URL<input id="server-url" value="${escapeHtml(serverUrl)}" ${busy ? "disabled" : ""} /></label>
          <div id="discovered-servers">${discoveredServersHtml(true)}</div>
          <label>Your name<input id="player-name" value="${escapeHtml(playerName)}" placeholder="Player name" ${busy ? "disabled" : ""} /></label>
          <button type="submit" ${busy || depsState.playBlocked ? "disabled" : ""}>Join</button>
        </form>
        <p class="status" id="status">${escapeHtml(statusLine)}</p>
        ${footer}
      </div>`;
    document.getElementById("back")!.onclick = () => {
      view = "welcome";
      render();
    };
    document.getElementById("join-form")!.onsubmit = (e) => {
      e.preventDefault();
      void onJoin();
    };
    wireJoinFormInputs();
    wirePickServerButtons();
    wireDepsPanel();
    wireFooterButtons();
    updatePlayButtons();
    restoreFocus(savedFocus);
    return;
  }

  root.innerHTML = `
    <div class="shell">
      <header>
        <h1>BizShuffle</h1>
        <p class="tagline">Host a session or join one as a player.</p>
      </header>
      ${deps}
      <div class="actions">
        <button type="button" id="host" ${busy ? "disabled" : ""}>Host</button>
        <button type="button" id="go-join" ${busy || depsState.playBlocked ? "disabled" : ""}>Join</button>
      </div>
      <details class="host-advanced">
        <summary>Host options</summary>
        <label class="bind-host-label">Bind address
          <input id="bind-host" value="${escapeHtml(bindHost)}" placeholder="${DEFAULT_BIND_HOST}" ${busy ? "disabled" : ""} />
        </label>
        <p class="bind-host-hint"><code>127.0.0.1</code> — local only. <code>0.0.0.0</code> — accept LAN connections.</p>
      </details>
      <div id="discovered-servers">${discoveredServersHtml(true, true)}</div>
      <div class="footer-actions">
        <button type="button" class="link" id="open-data">Open data folder</button>
        <button type="button" class="link" id="refresh-disc">Refresh discovery</button>
      </div>
      <p class="status" id="status">${escapeHtml(statusLine)}</p>
      ${footer}
    </div>`;

  document.getElementById("host")!.onclick = () => void onHost();
  wireBindHostInput();
  document.getElementById("go-join")!.onclick = () => {
    view = "join";
    render();
  };
  document.getElementById("open-data")!.onclick = () => void rpc.request.openFolder({});
  document.getElementById("refresh-disc")!.onclick = () => void refreshDiscovery(true);
  wirePickServerButtons();
  wireDepsPanel();
  wireFooterButtons();
  updatePlayButtons();
  restoreFocus(savedFocus);
  slog(`render:welcome done — host button=${document.getElementById("host") ? "yes" : "no"}`);
}

async function onHost(): Promise<void> {
  const bindInput = document.getElementById("bind-host") as HTMLInputElement | null;
  bindHost = bindInput?.value.trim() || DEFAULT_BIND_HOST;
  await persistShellSettings();
  busy = true;
  setStatus("Starting host…");
  render();
  try {
    const { url, bindHost: bound } = await rpc.request.host({ bindHost });
    setStatus(`Admin opened at ${url} (listening on ${bound})`);
  } catch (e) {
    setStatus(String(e));
  } finally {
    busy = false;
    render();
  }
}

async function onJoin(): Promise<void> {
  const blocked = playBlockedClientMessage();
  if (blocked) {
    setStatus(blocked);
    return;
  }
  serverUrl = (document.getElementById("server-url") as HTMLInputElement).value;
  playerName = (document.getElementById("player-name") as HTMLInputElement).value.trim();
  if (!playerName) {
    setStatus("Player name is required");
    return;
  }
  await persistShellSettings();
  busy = true;
  setStatus("Connecting…");
  render();
  try {
    await rpc.request.join({ serverUrl, playerName });
    setStatus(`Joined ${serverUrl} as ${playerName}`);
  } catch (e) {
    setStatus(String(e));
  } finally {
    busy = false;
    render();
  }
}

render();
slog("initial render complete");

void (async () => {
  try {
    rpc.send.shellReady({});
  } catch {
    /* bun may not be ready yet */
  }
  await loadShellSettingsFromDisk();
  await loadDependencies();
  await loadAppInfo();
  await refreshDiscovery();
})();
setInterval(() => void refreshDiscovery(), 5000);
