import type { Effect } from "effect";
import type { EmulatorState, ServerState } from "../schemas.js";
import type { ClientConfig, ServerConfig } from "../schemas.js";

export type { ClientConfig, ServerConfig };

export interface ServerRuntime {
  readonly start: (config: ServerConfig) => Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly state: Effect.Effect<ServerState>;
  readonly url: Effect.Effect<string>;
}

export interface ClientRuntime {
  readonly connect: (config: ClientConfig) => Effect.Effect<void>;
  readonly disconnect: Effect.Effect<void>;
  readonly connected: Effect.Effect<boolean>;
}

export interface EmulatorService {
  readonly launch: Effect.Effect<void, Error>;
  readonly stop: Effect.Effect<void>;
  readonly restart: Effect.Effect<void, Error>;
  readonly health: Effect.Effect<EmulatorState>;
}
