import { Context } from "effect";
import type { Command, EmulatorState, Player, ServerState } from "@bizshuffle-bun/protocol";

export interface SessionStore {
  readonly load: () => Promise<ServerState>;
  readonly save: (state: ServerState) => Promise<void>;
  readonly update: (fn: (s: ServerState) => void) => Promise<string>;
  readonly snapshot: () => ServerState;
}

export interface WsHubPort {
  readonly broadcastToPlayers: (cmd: Command) => void;
  readonly broadcastToAdmins: (cmd: Command) => void;
  readonly sendToPlayer: (player: Player, cmd: Command) => void;
  readonly sendAndWait: (player: Player, cmd: Command, timeoutMs?: number) => Promise<string>;
}

export interface Clock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface EmulatorPort {
  readonly launch: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly health: () => Promise<EmulatorState>;
}

export class SessionStoreTag extends Context.Tag("SessionStore")<SessionStoreTag, SessionStore>() {}
export class WsHubTag extends Context.Tag("WsHub")<WsHubTag, WsHubPort>() {}
export class ClockTag extends Context.Tag("Clock")<ClockTag, Clock>() {}
export class EmulatorPortTag extends Context.Tag("EmulatorPort")<EmulatorPortTag, EmulatorPort>() {}
