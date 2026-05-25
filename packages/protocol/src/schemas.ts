import { Schema } from "effect";

export const CommandNameSchema = Schema.Literal(
  "hello",
  "ack",
  "nack",
  "games_update_ack",
  "status_update",
  "lua_command",
  "config_response",
  "hello_admin",
  "ping",
  "start",
  "pause",
  "swap",
  "message",
  "games_update",
  "clear_saves",
  "request_save",
  "plugin_reload",
  "fullscreen_toggle",
  "check_config",
  "update_config",
  "state_update"
);

export const CommandSchema = Schema.Struct({
  cmd: CommandNameSchema,
  id: Schema.String,
  payload: Schema.optional(Schema.Unknown),
});

export const GameModeSchema = Schema.Literal("sync", "save");
export const FileStateSchema = Schema.Literal("none", "pending", "ready");
export const PluginStatusSchema = Schema.Literal("disabled", "enabled", "loading", "error");

export const GameEntrySchema = Schema.Struct({
  file: Schema.String,
  extra_files: Schema.optional(Schema.Array(Schema.String)),
});

export const PlayerSchema = Schema.Struct({
  name: Schema.String,
  has_files: Schema.Boolean,
  connected: Schema.Boolean,
  bizhawk_ready: Schema.Boolean,
  game: Schema.optional(Schema.String),
  instance_id: Schema.optional(Schema.String),
  ping_ms: Schema.optional(Schema.Number),
  completed_games: Schema.optional(Schema.Array(Schema.String)),
  completed_instances: Schema.optional(Schema.Array(Schema.String)),
  config_values: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export const GameSwapInstanceSchema = Schema.Struct({
  id: Schema.String,
  game: Schema.String,
  file_state: FileStateSchema,
  pending_player: Schema.optional(Schema.String),
});

export const PluginSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  bizhawk_version: Schema.String,
  description: Schema.String,
  author: Schema.String,
  status: PluginStatusSchema,
  settings_meta: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Struct({
        type: Schema.String,
        options: Schema.optional(Schema.Array(Schema.String)),
      }),
    })
  ),
});

export const ServerStateSchema = Schema.Struct({
  running: Schema.Boolean,
  swap_enabled: Schema.Boolean,
  mode: Schema.optional(GameModeSchema),
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Number),
  next_swap_at: Schema.optional(Schema.Number),
  min_interval_secs: Schema.optional(Schema.Number),
  max_interval_secs: Schema.optional(Schema.Number),
  main_games: Schema.optional(Schema.Array(GameEntrySchema)),
  plugins: Schema.optional(Schema.Record({ key: Schema.String, value: PluginSchema })),
  players: Schema.Record({ key: Schema.String, value: PlayerSchema }),
  updated_at: Schema.String,
  games: Schema.optional(Schema.Array(Schema.String)),
  game_instances: Schema.optional(Schema.Array(GameSwapInstanceSchema)),
  prevent_same_game_swap: Schema.Boolean,
  countdown_enabled: Schema.Boolean,
  swap_seed: Schema.optional(Schema.Number),
  config_keys: Schema.optional(Schema.Array(Schema.String)),
});

export const DiscoveryMessageSchema = Schema.Struct({
  type: Schema.String,
  version: Schema.String,
  server_name: Schema.String,
  host: Schema.String,
  port: Schema.Number,
  timestamp: Schema.String,
  server_id: Schema.String,
});

export type Command = Schema.Schema.Type<typeof CommandSchema>;
export type CommandName = Schema.Schema.Type<typeof CommandNameSchema>;
export type GameMode = Schema.Schema.Type<typeof GameModeSchema>;
export type FileState = Schema.Schema.Type<typeof FileStateSchema>;
export type PluginStatus = Schema.Schema.Type<typeof PluginStatusSchema>;
export type GameEntry = Schema.Schema.Type<typeof GameEntrySchema>;
export type Player = Schema.Schema.Type<typeof PlayerSchema>;
export type GameSwapInstance = Schema.Schema.Type<typeof GameSwapInstanceSchema>;
export type Plugin = Schema.Schema.Type<typeof PluginSchema>;
export type ServerState = Schema.Schema.Type<typeof ServerStateSchema>;
export type DiscoveryMessage = Schema.Schema.Type<typeof DiscoveryMessageSchema>;

export type LuaCmd = "swap" | "swap_me" | "message";
export type EmulatorState = "starting" | "running" | "stopped" | "crashed" | "hung";

export interface LuaCommand {
  Raw: string;
  Kind: LuaCmd;
  Fields: Record<string, string>;
}

export interface DiscoveryConfig {
  enabled: boolean;
  multicast_address: string;
  broadcast_interval_sec: number;
  listen_timeout_sec: number;
}

export const defaultDiscoveryConfig = (): DiscoveryConfig => ({
  enabled: true,
  multicast_address: "239.255.255.250:1900",
  broadcast_interval_sec: 5,
  listen_timeout_sec: 10,
});

export const defaultServerState = (): ServerState => ({
  running: false,
  swap_enabled: false,
  mode: "sync",
  players: {},
  updated_at: new Date().toISOString(),
  prevent_same_game_swap: false,
  countdown_enabled: false,
  min_interval_secs: 5,
  max_interval_secs: 10,
  config_keys: ["DisplayFps"],
  main_games: [],
  games: [],
  game_instances: [],
  plugins: {},
});

export const SWAP_WAIT_MS = 20_000;
export const IPC_TIMEOUT_MS = 10_000;
export const SAVE_READY_TIMEOUT_MS = 30_000;
export const PERSIST_DEBOUNCE_MS = 500;
export const DISCOVERY_VALID_MS = 30_000;

export interface ServerConfig {
  dataDir: string;
  host: string;
  port: number;
  /** Admin SPA root (priv/static). Required when server-host is bundled (e.g. Electrobun). */
  staticDir?: string;
}

export interface ClientConfig {
  dataDir: string;
  serverUrl: string;
  playerName: string;
}
