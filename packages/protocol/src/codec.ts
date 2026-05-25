import { Schema } from "effect";
import { CommandSchema, type Command, type CommandName } from "./schemas.js";

const CLIENT_TO_SERVER: CommandName[] = [
  "hello",
  "ack",
  "nack",
  "games_update_ack",
  "status_update",
  "lua_command",
  "config_response",
  "hello_admin",
];

const SERVER_TO_CLIENT: CommandName[] = [
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
  "state_update",
];

const decodeCommandSync = Schema.decodeUnknownSync(CommandSchema);

export function encodeCommand(cmd: Command): string {
  return JSON.stringify({
    cmd: cmd.cmd,
    id: cmd.id,
    ...(cmd.payload !== undefined ? { payload: cmd.payload } : {}),
  });
}

export function decodeCommand(raw: string): Command {
  const parsed = JSON.parse(raw) as unknown;
  return decodeCommandSync(parsed);
}

export function isClientToServer(cmd: CommandName): boolean {
  return CLIENT_TO_SERVER.includes(cmd);
}

export function isServerToClient(cmd: CommandName): boolean {
  return SERVER_TO_CLIENT.includes(cmd);
}
