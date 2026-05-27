import { describe, expect, it } from "bun:test";
import { parseLuaCommand } from "./lua.js";

describe("parseLuaCommand", () => {
  it("parses plugin swap_me with message field", () => {
    const line =
      "CMD|swap_me|message=Memory Tracker: Banjo-Kazooie (USA) door value changed: 32792 -> 32785 (Location change)";
    const cmd = parseLuaCommand(line);
    expect(cmd.Kind).toBe("swap_me");
    expect(cmd.Fields.message).toContain("32792 -> 32785");
  });

  it("rejects non-plugin controller command kinds", () => {
    expect(() => parseLuaCommand("CMD|1738123|SAVE|instance-1")).toThrow(/unknown lua kind/);
  });
});
