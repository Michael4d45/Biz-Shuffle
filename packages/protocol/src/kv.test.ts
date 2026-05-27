import { describe, expect, it } from "bun:test";
import { parseSettingsMeta } from "./kv.js";

describe("parseSettingsMeta", () => {
  it("parses dropdown and multiselect hints from meta.kv keys", () => {
    const meta = parseSettingsMeta({
      name: "memory-tracker",
      "setting.command_type.type": "dropdown",
      "setting.command_type.options": "swap,swap_me",
      "setting.enabled_types.type": "multiselect",
      "setting.enabled_types.options": "door,health",
    });

    expect(meta.command_type).toEqual({
      type: "dropdown",
      options: ["swap", "swap_me"],
    });
    expect(meta.enabled_types).toEqual({
      type: "multiselect",
      options: ["door", "health"],
    });
  });

  it("ignores unrelated meta keys", () => {
    expect(parseSettingsMeta({ version: "1.0.0" })).toEqual({});
  });
});
