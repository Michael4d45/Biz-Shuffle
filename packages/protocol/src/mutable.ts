import type { GameSwapInstance, Player, Plugin, ServerState } from "./schemas.js";

export type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;

/** Writable server state for in-memory mutation (Effect Schema types are deeply readonly). */
export type MutableServerState = DeepMutable<ServerState>;
export type MutablePlayer = DeepMutable<Player>;
export type MutablePlugin = DeepMutable<Plugin>;
export type MutableGameSwapInstance = DeepMutable<GameSwapInstance>;
