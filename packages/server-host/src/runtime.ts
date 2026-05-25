import { Effect } from "effect";
import type { ServerConfig, ServerRuntime, ServerState } from "@bizshuffle-bun/protocol";
import { BizShuffleServer } from "./server.js";
import { freshServerState } from "./session.js";

export function createServerRuntime(): ServerRuntime {
  let server: BizShuffleServer | null = null;

  return {
    start: (config: ServerConfig) =>
      Effect.promise(async () => {
        server = new BizShuffleServer(config);
        await server.start();
      }),
    stop: Effect.promise(async () => {
      await server?.stop();
      server = null;
    }),
    state: Effect.sync((): ServerState => server?.snapshotState() ?? freshServerState()),
    url: Effect.sync((): string => server?.url ?? ""),
  };
}
