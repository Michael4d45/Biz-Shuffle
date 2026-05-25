import { Electroview } from "electrobun/view";
import type { ShellRPCSchema } from "../../shared/rpc.js";

const rpc = Electroview.defineRPC<ShellRPCSchema>({
  handlers: {
    requests: {},
    messages: {
      status: ({ msg }) => {
        const el = document.getElementById("status");
        if (el) el.textContent = msg;
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
  if (view === "join") {
    const disc =
      discovered.length > 0
        ? `<div class="discovered"><span>Discovered:</span><ul>${discovered
            .map(
              (d) =>
                `<li><button type="button" class="link pick-server" data-url="${d.url}">${d.label} (${d.url})</button></li>`
            )
            .join("")}</ul></div>`
        : "";
    root.innerHTML = `
      <div class="shell">
        <header>
          <button type="button" class="link" id="back">← Back</button>
          <h1>Join session</h1>
        </header>
        <form class="join-form" id="join-form">
          <label>Server URL<input id="server-url" value="${serverUrl}" ${busy ? "disabled" : ""} /></label>
          ${disc}
          <label>Your name<input id="player-name" value="${playerName}" placeholder="Player name" ${busy ? "disabled" : ""} /></label>
          <button type="submit" ${busy ? "disabled" : ""}>Join</button>
        </form>
        <p class="status" id="status">${statusLine}</p>
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
    return;
  }

  root.innerHTML = `
    <div class="shell">
      <header>
        <h1>BizShuffle</h1>
        <p class="tagline">Host a session, join a friend, or do both.</p>
      </header>
      <div class="actions">
        <button type="button" id="host" ${busy ? "disabled" : ""}>Host</button>
        <button type="button" id="go-join" ${busy ? "disabled" : ""}>Join</button>
        <button type="button" id="host-play" ${busy ? "disabled" : ""}>Host &amp; Play</button>
      </div>
      <label class="inline-name">Player name (Host &amp; Play)
        <input id="inline-name" value="${playerName}" placeholder="Host" ${busy ? "disabled" : ""} />
      </label>
      <div class="footer-actions">
        <button type="button" class="link" id="open-data">Open data folder</button>
        <button type="button" class="link" id="refresh-disc">Refresh discovery</button>
      </div>
      <p class="status" id="status">${statusLine}</p>
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
  const hostBtn = document.getElementById("host");
  slog(`render:welcome done — host button=${hostBtn ? "yes" : "no"}`);
}

async function onHost(): Promise<void> {
  busy = true;
  setStatus("Starting host…");
  render(); // statusLine preserved in template
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
void refreshDiscovery();
setInterval(() => void refreshDiscovery(), 5000);
