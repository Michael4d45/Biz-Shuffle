import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Utils, defineElectrobunRPC } from "electrobun/bun";
import {
  checkForUpdates,
  getAppInfo,
  initAppUpdates,
  installUpdate,
  setAppUpdateSender,
} from "./app-updates.js";
import {
  initDependencies,
  installDependency,
  playBlockedReason,
  refreshDependencies,
  setDependenciesSender,
} from "./dependencies.js";
import { BizShuffleServer, syncCatalogFromRoms } from "@bizshuffle-bun/server-host";
import type { DiscoveredServerEntry } from "../shared/rpc.js";
import {
  ClientRuntime,
  DiscoveryListener,
  ensureBizHawkReady,
  reserveLuaPort,
  writeLuaPortFile,
} from "@bizshuffle-bun/client-host";
import type { ShellRPCSchema } from "../shared/rpc.js";
import { desktopAdminStaticDir } from "./admin-static.js";
import { DesktopEmulatorService } from "./emulator-service.js";
import { DESKTOP_LOG_FILE, desktopLog } from "./log.js";
import { seedRomsFromRepoIfEmpty } from "./seed-dev-roms.js";
import { loadShellSettings, saveShellSettings } from "./shell-settings.js";

const SERVER_LUA_CANDIDATES = [
  join(dirname(fileURLToPath(import.meta.url)), "../../../assets/server.lua"),
  join(dirname(fileURLToPath(import.meta.url)), "../../../../assets/server.lua"),
  join(dirname(fileURLToPath(import.meta.url)), "../assets/server.lua"),
];

desktopLog("bizshuffle-bun", `desktop main starting (log file: ${DESKTOP_LOG_FILE})`);

const DEFAULT_HOST = "127.0.0.1";
/** 0 = pick a free port (avoids conflict with headless dev:server on 8080). */
const DEFAULT_PORT = 0;
const CLIENT_CONNECT_TIMEOUT_MS = 30_000;

let shellWindow: BrowserWindow | null = null;
let adminWindow: BrowserWindow | null = null;
let server: BizShuffleServer | null = null;
let hostedBindHost: string | null = null;
let clientRuntime: ClientRuntime | null = null;
let discoveryListener: DiscoveryListener | null = null;
const emulator = new DesktopEmulatorService();

function dataDir(): string {
  const dir = join(homedir(), "BizShuffle");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function shellRpcSend():
  | {
      status: (payload: { msg: string }) => void;
      updateState: (payload: ShellRPCSchema["webview"]["messages"]["updateState"]) => void;
      dependenciesState: (
        payload: ShellRPCSchema["webview"]["messages"]["dependenciesState"]
      ) => void;
    }
  | undefined {
  try {
    return (
      shellWindow?.webview?.rpc as
        | {
            send: {
              status: (payload: { msg: string }) => void;
              updateState: (payload: ShellRPCSchema["webview"]["messages"]["updateState"]) => void;
              dependenciesState: (
                payload: ShellRPCSchema["webview"]["messages"]["dependenciesState"]
              ) => void;
            };
          }
        | undefined
    )?.send;
  } catch {
    return undefined;
  }
}

function sendStatus(msg: string): void {
  shellRpcSend()?.status({ msg });
}

function sendUpdateState(state: ShellRPCSchema["webview"]["messages"]["updateState"]): void {
  shellRpcSend()?.updateState(state);
}

function sendDependenciesState(
  state: ShellRPCSchema["webview"]["messages"]["dependenciesState"]
): void {
  shellRpcSend()?.dependenciesState(state);
}

function assertPlayReady(dir: string): void {
  const blocked = playBlockedReason(dir);
  if (blocked) {
    refreshDependencies(dir);
    throw new Error(blocked);
  }
}

function depProgress(msg: string): void {
  desktopLog("bizshuffle-bun", msg);
}

function normalizeServerUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function isLocalhostHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function serverUrlsMatch(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.port !== ub.port) return false;
    return isLocalhostHost(ua.hostname) && isLocalhostHost(ub.hostname);
  } catch {
    return normalizeServerUrl(a) === normalizeServerUrl(b);
  }
}

function ensureDiscoveryListener(): DiscoveryListener {
  if (!discoveryListener) {
    discoveryListener = new DiscoveryListener();
    discoveryListener.start();
  }
  return discoveryListener;
}

function purgeDiscoveredServer(url: string): void {
  discoveryListener?.removeMatchingUrl(url);
}

async function stopHostingSession(): Promise<void> {
  const hostedUrl = server?.url;
  clientRuntime?.stop();
  clientRuntime = null;
  emulator.stop();
  await stopServer();
  if (hostedUrl) purgeDiscoveredServer(hostedUrl);
  sendStatus("Host stopped");
}

async function getDiscoveredServers(): Promise<DiscoveredServerEntry[]> {
  ensureDiscoveryListener();
  discoveryListener!.pruneExpired();
  const hosted = server?.url ?? null;
  const entries = discoveryListener!.getDiscovered().map((s) => {
    const url = `http://${s.message.host}:${s.message.port}`;
    return {
      label: s.message.server_name || s.message.server_id,
      url,
      isHosted: hosted ? serverUrlsMatch(url, hosted) : false,
    };
  });
  if (hosted && !entries.some((e) => e.isHosted)) {
    entries.unshift({
      label: server?.getServerName() ?? "This session",
      url: hosted,
      isHosted: true,
    });
  }
  return entries;
}

function normalizeBindHost(raw?: string): string {
  const host = (raw ?? DEFAULT_HOST).trim();
  if (!host) return DEFAULT_HOST;
  if (!/^[\da-fA-F:.%-]+$/.test(host)) {
    throw new Error(`Invalid bind address: ${host}`);
  }
  return host;
}

/** URL to open admin locally (0.0.0.0 / :: are not useful in the webview). */
function localAdminUrl(bindHost: string, port: number): string {
  if (bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "[::]") {
    return `http://127.0.0.1:${port}`;
  }
  return `http://${bindHost}:${port}`;
}

async function ensureServerStarted(
  bindHost = DEFAULT_HOST
): Promise<{ adminUrl: string; bindHost: string }> {
  const host = normalizeBindHost(bindHost);
  const dir = dataDir();
  seedRomsFromRepoIfEmpty(dir);
  if (server && hostedBindHost !== host) {
    desktopLog("bizshuffle-bun", `restarting embedded server (bind ${hostedBindHost} -> ${host})`);
    await stopServer();
  }
  if (!server) {
    const staticDir = desktopAdminStaticDir();
    desktopLog(
      "bizshuffle-bun",
      `embedded server staticDir=${staticDir ?? "(resolve from bundle)"} bind=${host}`
    );
    server = new BizShuffleServer({
      dataDir: dir,
      host,
      port: DEFAULT_PORT,
      ...(staticDir ? { staticDir } : {}),
    });
    await server.start();
    hostedBindHost = host;
    desktopLog("bizshuffle-bun", `embedded server listening at ${server.url} (bind ${host})`);
  }
  if (await syncCatalogFromRoms(server)) {
    server.broadcastGamesUpdate();
    desktopLog("bizshuffle-bun", "embedded server catalog synced from roms/");
  }
  const parsed = new URL(server.url);
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  return { adminUrl: localAdminUrl(host, port), bindHost: host };
}

async function stopServer(): Promise<void> {
  if (server) {
    const url = server.url;
    await server.stop();
    server = null;
    hostedBindHost = null;
    purgeDiscoveredServer(url);
  }
}

async function joinWithEmulator(serverUrl: string, playerName: string): Promise<void> {
  const dir = dataDir();
  assertPlayReady(dir);
  sendStatus("Stopping previous player session…");
  clientRuntime?.stop();
  clientRuntime = null;
  emulator.stop();
  await new Promise((r) => setTimeout(r, 300));
  sendStatus("Checking BizHawk…");
  const emuPath = await ensureBizHawkReady(dir, { progress: depProgress });
  refreshDependencies(dir);
  sendStatus("Reserving Lua IPC port…");
  const luaPort = await reserveLuaPort();
  const portFile = join(dir, "lua_server_port.txt");
  writeLuaPortFile(portFile, luaPort);
  desktopLog("bizshuffle-bun", `lua IPC port ${luaPort} written to ${portFile}`);
  sendStatus("Launching BizHawk…");
  desktopLog("bizshuffle-bun", `launching BizHawk at ${emuPath}`);
  await emulator.launch(dir, emuPath, SERVER_LUA_CANDIDATES);
  sendStatus(`Joining ${serverUrl} as ${playerName}…`);
  await startClient(serverUrl, playerName, { luaPort });
  sendStatus(`Connected as ${playerName}`);
}

function openAdminWindow(url: string): void {
  if (adminWindow) {
    try {
      adminWindow.webview.loadURL(url);
      adminWindow.focus();
      return;
    } catch {
      adminWindow = null;
    }
  }

  adminWindow = new BrowserWindow({
    title: "BizShuffle Admin",
    url,
    frame: { x: 120, y: 80, width: 1100, height: 800 },
    sandbox: true,
    titleBarStyle: "default",
    transparent: false,
    passthrough: false,
    html: null,
    preload: null,
    viewsRoot: null,
    navigationRules: null,
  });

  adminWindow.on("close", () => {
    adminWindow = null;
    void stopHostingSession();
  });
}

async function startClient(
  serverUrl: string,
  playerName: string,
  options?: { luaPort?: number }
): Promise<void> {
  clientRuntime?.stop();
  clientRuntime = new ClientRuntime({
    dataDir: dataDir(),
    serverUrl,
    playerName,
    enableDiscovery: false,
    ...(options?.luaPort != null ? { luaPort: options.luaPort } : {}),
  });
  desktopLog("bizshuffle-bun", `client connecting to ${serverUrl} as ${playerName}`);
  await Promise.race([
    clientRuntime.start(),
    new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Player client did not connect within ${CLIENT_CONNECT_TIMEOUT_MS / 1000}s (check server URL and logs)`
            )
          ),
        CLIENT_CONNECT_TIMEOUT_MS
      );
    }),
  ]);
  desktopLog("bizshuffle-bun", "client connected");
}

function defineShellRpc() {
  return defineElectrobunRPC<ShellRPCSchema>("bun", {
    maxRequestTime: 60_000,
    handlers: {
      requests: {
        host: async (params: unknown) => {
          try {
            const { bindHost } = params as ShellRPCSchema["bun"]["requests"]["host"]["params"];
            sendStatus("Starting server…");
            desktopLog("bizshuffle-bun", `RPC host bind=${bindHost ?? DEFAULT_HOST}`);
            const { adminUrl, bindHost: bound } = await ensureServerStarted(bindHost);
            sendStatus(`Admin opened at ${adminUrl} (bound to ${bound})`);
            openAdminWindow(adminUrl);
            return { url: adminUrl, bindHost: bound };
          } catch (err) {
            desktopLog("bizshuffle-bun", `host failed: ${err}`);
            throw err;
          }
        },
        join: async (params: unknown) => {
          const { serverUrl, playerName } =
            params as ShellRPCSchema["bun"]["requests"]["join"]["params"];
          try {
            desktopLog("bizshuffle-bun", `RPC join ${serverUrl} as ${playerName}`);
            await joinWithEmulator(serverUrl, playerName);
            return { ok: true };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            desktopLog("bizshuffle-bun", `join failed: ${msg}`);
            sendStatus(`Error: ${msg}`);
            throw err;
          }
        },
        discover: async () => {
          const servers = await getDiscoveredServers();
          return { hostedUrl: server?.url ?? null, servers };
        },
        getShellSettings: async () => loadShellSettings(dataDir()),
        saveShellSettings: async (params: unknown) => {
          const patch = params as ShellRPCSchema["bun"]["requests"]["saveShellSettings"]["params"];
          return saveShellSettings(dataDir(), patch);
        },
        getDataDir: async () => dataDir(),
        openFolder: async (params: unknown) => {
          const { subpath } = (params ??
            {}) as ShellRPCSchema["bun"]["requests"]["openFolder"]["params"];
          const target = subpath ? join(dataDir(), subpath) : dataDir();
          mkdirSync(target, { recursive: true });
          Utils.openPath(target);
        },
        getAppInfo: async () => getAppInfo(),
        checkForUpdates: async () => checkForUpdates(),
        installUpdate: async () => {
          await installUpdate();
        },
        getDependencies: async () => refreshDependencies(dataDir()),
        installDependency: async (params: unknown) => {
          const { id } = params as ShellRPCSchema["bun"]["requests"]["installDependency"]["params"];
          return installDependency(dataDir(), id, depProgress);
        },
      },
      messages: {
        diag: (payload: unknown) => {
          const { line } = payload as ShellRPCSchema["bun"]["messages"]["diag"];
          desktopLog("bizshuffle-shell", line);
        },
        shellReady: () => {
          refreshDependencies(dataDir());
        },
      } as NonNullable<
        Parameters<typeof defineElectrobunRPC<ShellRPCSchema>>[1]["handlers"]
      >["messages"],
    },
  });
}

const shellRpc = defineShellRpc();

desktopLog("bizshuffle-bun", "creating shell BrowserWindow (views://shell/index.html)");
shellWindow = new BrowserWindow({
  title: "BizShuffle",
  url: "views://shell/index.html",
  frame: { x: 200, y: 120, width: 520, height: 580 },
  rpc: shellRpc,
  titleBarStyle: "default",
  transparent: false,
  passthrough: false,
  html: null,
  preload: null,
  viewsRoot: null,
  navigationRules: null,
  sandbox: false,
});

shellWindow.on("close", () => {
  desktopLog("bizshuffle-bun", "shell window closed");
  shellWindow = null;
});

desktopLog("bizshuffle-bun", "shell window created");

setAppUpdateSender(sendUpdateState);
initAppUpdates();
setDependenciesSender(sendDependenciesState);
initDependencies(dataDir());

async function shutdown(): Promise<void> {
  clientRuntime?.stop();
  clientRuntime = null;
  emulator.stop();
  discoveryListener?.stop();
  discoveryListener = null;
  adminWindow?.close();
  adminWindow = null;
  await stopServer();
}

process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

desktopLog("bizshuffle-bun", "desktop ready — Host / Join in shell window");
