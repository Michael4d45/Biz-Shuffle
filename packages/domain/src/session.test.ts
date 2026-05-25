import { describe, expect, it } from "bun:test";
import { ServerSession } from "./session.js";

describe("ServerSession", () => {
  it("updates players", () => {
    const s = new ServerSession();
    s.update((st) => {
      st.players["a"] = { name: "a", connected: false, has_files: false, bizhawk_ready: false };
    });
    expect(s.snapshot.players["a"]?.name).toBe("a");
  });
});
