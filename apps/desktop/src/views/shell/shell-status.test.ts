import { describe, expect, test } from "bun:test";
import { formatShellError } from "./shell-status.js";

describe("shell-status", () => {
  test("passes through real error messages", () => {
    expect(formatShellError(new Error("Player name is required"), "fallback")).toBe(
      "Player name is required"
    );
  });

  test("strips Error prefix from user-facing messages", () => {
    expect(formatShellError(new Error("Error: BizHawk is required"), "fallback")).toBe(
      "BizHawk is required"
    );
  });
});
