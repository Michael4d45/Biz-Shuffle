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

async function ensureServerStarted(): Promise<string> {
  const dir = dataDir();
  seedRomsFromRepoIfEmpty(dir);
  if (!server) {
    const staticDir = desktopAdminStaticDir();
    desktopLog(
      "bizshuffle-bun",
      `embedded server staticDir=${staticDir ?? "(resolve from bundle)"}`
    );
    server = new BizShuffleServer({
      dataDir: dir,
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      ...(staticDir ? { staticDir } : {}),
    });
    await server.start();
    desktopLog("bizshuffle-bun", `embedded server listening at ${server.url}`);
  }
  if (await syncCatalogFromRoms(server)) {
    server.broadcastGamesUpdate();
    desktopLog("bizshuffle-bun", "embedded server catalog synced from roms/");
  }
  return server.url;
}

async function stopServer(): Promise<void> {
  if (server) {
    await server.stop();
    server = null;
  }
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
        host: async () => {
          try {
            sendStatus("Starting server…");
            desktopLog("bizshuffle-bun", "RPC host");
            const url = await ensureServerStarted();
            sendStatus(`Admin opened at ${url}`);
            openAdminWindow(url);
            return { url };
          } catch (err) {
            desktopLog("bizshuffle-bun", `host failed: ${err}`);
            throw err;
          }
        },
        join: async (params: unknown) => {
          const { serverUrl, playerName } =
            params as ShellRPCSchema["bun"]["requests"]["join"]["params"];
          const dir = dataDir();
          assertPlayReady(dir);
          sendStatus("Checking BizHawk…");
          await ensureBizHawkReady(dir, { progress: depProgress });
          refreshDependencies(dir);
          sendStatus(`Joining ${serverUrl} as ${playerName}…`);
          await startClient(serverUrl, playerName);
          sendStatus(`Connected as ${playerName}`);
          return { ok: true };
        },
        hostAndPlay: async (params: unknown) => {
          const { playerName } =
            params as ShellRPCSchema["bun"]["requests"]["hostAndPlay"]["params"];
          try {
            desktopLog("bizshuffle-bun", `RPC hostAndPlay player=${playerName}`);
            sendStatus("Host & Play: starting server…");
            const url = await ensureServerStarted();
            const dir = dataDir();
            sendStatus("Host & Play: stopping previous session…");
            clientRuntime?.stop();
            clientRuntime = null;
            emulator.stop();
            await new Promise((r) => setTimeout(r, 300));
            assertPlayReady(dir);
            sendStatus("Checking BizHawk…");
            const emuPath = await ensureBizHawkReady(dir, { progress: depProgress });
            refreshDependencies(dir);
            sendStatus("Host & Play: reserving Lua IPC port…");
            const luaPort = await reserveLuaPort();
            const portFile = join(dir, "lua_server_port.txt");
            writeLuaPortFile(portFile, luaPort);
            desktopLog("bizshuffle-bun", `lua IPC port ${luaPort} written to ${portFile}`);
            sendStatus("Host & Play: launching BizHawk…");
            desktopLog("bizshuffle-bun", `launching BizHawk at ${emuPath}`);
            await emulator.launch(dir, emuPath, SERVER_LUA_CANDIDATES);
            desktopLog("bizshuffle-bun", `BizHawk running pid=${emulator.exePath ?? emuPath}`);
            sendStatus("Host & Play: connecting client…");
            await startClient(url, playerName, { luaPort });
            sendStatus(`Host & Play ready — admin at ${url}`);
            openAdminWindow(url);
            desktopLog("bizshuffle-bun", `hostAndPlay complete ${url}`);
            return { url };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            desktopLog("bizshuffle-bun", `hostAndPlay failed: ${msg}`);
            sendStatus(`Error: ${msg}`);
            throw err;
          }
        },
        discover: async () => {
          if (!discoveryListener) {
            discoveryListener = new DiscoveryListener();
            discoveryListener.start();
          }
          return discoveryListener.getDiscovered().map((s) => s.message);
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

desktopLog("bizshuffle-bun", "desktop ready — Host / Join / Host & Play in shell window");
