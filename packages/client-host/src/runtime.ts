import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import type { ClientConfig as RuntimeClientConfig } from "@bizshuffle-bun/protocol";
import { BizhawkIpc, reserveLuaPort, writeLuaPortFile } from "./bizhawk-ipc.js";
import { ClientApi } from "./api.js";
import { Controller } from "./controller.js";
import { DiscoveryListener } from "./discovery-listener.js";
import {
  ensureDefaults,
  httpBaseFromServer,
  loadConfig,
  saveConfig,
  wsUrlFromHttpBase,
  type ClientConfigMap,
} from "./config.js";
import { PluginSyncManager } from "./plugin-sync.js";
import { WsClient } from "./ws-client.js";

export interface ClientRuntimeOptions {
  dataDir: string;
  serverUrl: string;
  playerName: string;
  enableDiscovery?: boolean;
  enableBizhawkIpc?: boolean;
  /** When set, use this port instead of reading/reserving via port file. */
  luaPort?: number;
}

export class ClientRuntime {
  private ws: WsClient | null = null;
  private bipc: BizhawkIpc | null = null;
  private discovery: DiscoveryListener | null = null;
  private abort: AbortController | null = null;
  private connected = false;

  constructor(private readonly options: ClientRuntimeOptions) {}

  get isConnected(): boolean {
    return this.connected;
  }

  connectEffect(config: RuntimeClientConfig): Effect.Effect<void, Error> {
    return Effect.tryPromise({
      try: () =>
        this.start({
          dataDir: config.dataDir,
          serverUrl: config.serverUrl,
          playerName: config.playerName,
        }),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });
  }

  disconnectEffect(): Effect.Effect<void> {
    return Effect.sync(() => this.stop());
  }

  connectedEffect(): Effect.Effect<boolean> {
    return Effect.sync(() => this.connected);
  }

  async start(overrides?: Partial<ClientRuntimeOptions>): Promise<void> {
    const opts = { ...this.options, ...overrides };
    mkdirSync(opts.dataDir, { recursive: true });
    const cfg = loadConfig(opts.dataDir);
    ensureDefaults(cfg);
    cfg.name = opts.playerName;
    cfg.server = opts.serverUrl;
    saveConfig(opts.dataDir, cfg);

    const httpBase = httpBaseFromServer(opts.serverUrl);
    const wsUrl = wsUrlFromHttpBase(httpBase);
    const api = new ClientApi(httpBase);
    const pluginsDir = join(opts.dataDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });

    if (opts.enableBizhawkIpc !== false) {
      const portFile = join(opts.dataDir, "lua_server_port.txt");
      if (opts.luaPort != null) {
        writeLuaPortFile(portFile, opts.luaPort);
      } else if (!existsSync(portFile)) {
        const port = await reserveLuaPort();
        writeLuaPortFile(portFile, port);
      }
      this.bipc = new BizhawkIpc({
        portFile,
        ...(opts.luaPort != null ? { port: opts.luaPort } : {}),
      });
      const launched = opts.bizhawkLaunched !== false;
      if (!launched) this.bipc.setBizhawkLaunched(false);
      await this.bipc.start();
      if (launched) this.bipc.setBizhawkLaunched(true);
    }

    const pluginSync = new PluginSyncManager(api, pluginsDir);
    await pluginSync.syncPlugins().catch(() => undefined);

    if (opts.enableDiscovery) {
      this.discovery = new DiscoveryListener();
      this.discovery.start();
    }

    this.abort = new AbortController();
    const controller = new Controller({
      dataDir: opts.dataDir,
      api,
      bipc: this.bipc,
      pluginsDir,
      send: async (cmd) => {
        if (!this.ws) return;
        await this.ws.send(cmd);
      },
    });

    this.ws = new WsClient({
      wsUrl,
      playerName: opts.playerName,
      bizhawkReady: this.bipc?.isReady() ?? false,
      signal: this.abort.signal,
      onCommand: (cmd) => void controller.handle(cmd),
      onConnected: () => {
        this.connected = true;
      },
      onDisconnected: () => {
        this.connected = false;
      },
    });

    await this.ws.start();
  }

  setBizhawkLaunched(launched: boolean): void {
    this.bipc?.setBizhawkLaunched(launched);
  }

  stop(): void {
    this.abort?.abort();
    this.ws?.stop();
    this.ws = null;
    this.bipc?.stop();
    this.bipc = null;
    this.discovery?.stop();
    this.discovery = null;
    this.connected = false;
  }
}

export function createClientRuntime(options: ClientRuntimeOptions): ClientRuntime {
  return new ClientRuntime(options);
}

export function loadClientConfig(dataDir: string): ClientConfigMap {
  const cfg = loadConfig(dataDir);
  ensureDefaults(cfg);
  return cfg;
}
