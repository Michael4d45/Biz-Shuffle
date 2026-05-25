import type { ServerState } from "@bizshuffle-bun/protocol";
import type { SessionStore } from "@bizshuffle-bun/ports";
import { freshServerState, ServerSession } from "@bizshuffle-bun/domain";

export class MemorySessionStore implements SessionStore {
  private readonly session = new ServerSession(freshServerState());

  async load(): Promise<ServerState> {
    return this.session.snapshot;
  }

  async save(state: ServerState): Promise<void> {
    this.session.setState(structuredClone(state));
  }

  async update(fn: (s: ServerState) => void): Promise<string> {
    return this.session.update(fn);
  }

  snapshot(): ServerState {
    return this.session.snapshot;
  }
}
