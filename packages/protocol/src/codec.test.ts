import { describe, expect, it } from "bun:test";
import { decodeCommand, encodeCommand } from "./codec.js";

describe("codec", () => {
  it("round-trips hello", () => {
    const cmd = { cmd: "hello" as const, id: "1", payload: { name: "p1" } };
    const decoded = decodeCommand(encodeCommand(cmd));
    expect(decoded.cmd).toBe("hello");
    expect(decoded.id).toBe("1");
  });
});
