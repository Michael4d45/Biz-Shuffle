import { Electroview } from "electrobun/view";
import type { AppUpdateState, DependenciesState, ShellRPCSchema } from "../../shared/rpc.js";

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

let busy = false;
let view: "welcome" | "join" = "welcome";
let serverUrl = "http://127.0.0.1:8080";
let playerName = "";
let statusLine = "";
let discovered: { label: string; url: string }[] = [];

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
      ? `<p class="deps-hint">Install or update the items above before Join or Host &amp; Play.</p>`
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
  for (const id of ["go-join", "host-play"]) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.disabled = blocked || busy;
  }
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

async function refreshDiscovery(): Promise<void> {
  try {
    const list = await rpc.request.discover({});
    discovered = list.map((m) => ({
      label: m.server_name || m.server_id,
      url: `http://${m.host}:${m.port}`,
    }));
    render();
  } catch (e) {
    setStatus(String(e));
  }
}

function render(): void {
  if (!root) {
    slog("render skipped — no #root");
    return;
  }
  slog(`render:${view}`);
  const deps = depsPanelHtml();
  const footer = footerHtml();

  if (view === "join") {
    const disc =
      discovered.length > 0
        ? `<div class="discovered"><span>Discovered:</span><ul>${discovered
            .map(
              (d) =>
                `<li><button type="button" class="link pick-server" data-url="${escapeHtml(d.url)}">${escapeHtml(d.label)} (${escapeHtml(d.url)})</button></li>`
            )
            .join("")}</ul></div>`
        : "";
    root.innerHTML = `
      <div class="shell">
        <header>
          <button type="button" class="link" id="back">← Back</button>
          <h1>Join session</h1>
        </header>
        ${deps}
        <form class="join-form" id="join-form">
          <label>Server URL<input id="server-url" value="${escapeHtml(serverUrl)}" ${busy ? "disabled" : ""} /></label>
          ${disc}
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
    document.querySelectorAll(".pick-server").forEach((btn) => {
      btn.addEventListener("click", () => {
        serverUrl = (btn as HTMLButtonElement).dataset.url ?? serverUrl;
        render();
      });
    });
    wireDepsPanel();
    wireFooterButtons();
    updatePlayButtons();
    return;
  }

  root.innerHTML = `
    <div class="shell">
      <header>
        <h1>BizShuffle</h1>
        <p class="tagline">Host a session, join a friend, or do both.</p>
      </header>
      ${deps}
      <div class="actions">
        <button type="button" id="host" ${busy ? "disabled" : ""}>Host</button>
        <button type="button" id="go-join" ${busy || depsState.playBlocked ? "disabled" : ""}>Join</button>
        <button type="button" id="host-play" ${busy || depsState.playBlocked ? "disabled" : ""}>Host &amp; Play</button>
      </div>
      <label class="inline-name">Player name (Host &amp; Play)
        <input id="inline-name" value="${escapeHtml(playerName)}" placeholder="Host" ${busy ? "disabled" : ""} />
      </label>
      <div class="footer-actions">
        <button type="button" class="link" id="open-data">Open data folder</button>
        <button type="button" class="link" id="refresh-disc">Refresh discovery</button>
      </div>
      <p class="status" id="status">${escapeHtml(statusLine)}</p>
      ${footer}
    </div>`;

  document.getElementById("host")!.onclick = () => void onHost();
  document.getElementById("go-join")!.onclick = () => {
    view = "join";
    render();
  };
  document.getElementById("host-play")!.onclick = () => void onHostAndPlay();
  document.getElementById("open-data")!.onclick = () => void rpc.request.openFolder({});
  document.getElementById("refresh-disc")!.onclick = () => void refreshDiscovery();
  document.getElementById("inline-name")!.oninput = (e) => {
    playerName = (e.target as HTMLInputElement).value;
  };
  wireDepsPanel();
  wireFooterButtons();
  updatePlayButtons();
  slog(`render:welcome done — host button=${document.getElementById("host") ? "yes" : "no"}`);
}

async function onHost(): Promise<void> {
  busy = true;
  setStatus("Starting host…");
  render();
  try {
    const { url } = await rpc.request.host({});
    setStatus(`Admin opened at ${url}`);
  } catch (e) {
    setStatus(String(e));
  } finally {
    busy = false;
    render();
  }
}

async function onHostAndPlay(): Promise<void> {
  const blocked = playBlockedClientMessage();
  if (blocked) {
    setStatus(blocked);
    return;
  }
  const name = playerName.trim() || "Host";
  busy = true;
  setStatus("Starting Host & Play…");
  render();
  try {
    const { url } = await rpc.request.hostAndPlay({ playerName: name });
    setStatus(`Host & Play ready — ${url}`);
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
  await loadDependencies();
  await loadAppInfo();
})();
void refreshDiscovery();
setInterval(() => void refreshDiscovery(), 5000);
