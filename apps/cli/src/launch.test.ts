import { describe, expect, test } from "bun:test";
import { parseLaunchArgs } from "./launch";

describe("parseLaunchArgs", () => {
  test("parses backend and passthrough args", () => {
    expect(
      parseLaunchArgs(["launch", "claude", "--profile", "default", "--", "-p", "fix tests"]),
    ).toEqual({
      backend: "claude",
      profileId: "default",
      model: undefined,
      cwd: undefined,
      yes: false,
      persistSelection: false,
      passthroughArgs: ["-p", "fix tests"],
    });
  });

  test("parses model and cwd flags", () => {
    expect(
      parseLaunchArgs([
        "launch",
        "codex",
        "--model",
        "gpt-4.1",
        "--cwd",
        "/tmp/repo",
        "--yes",
        "--save-harness",
      ]),
    ).toEqual({
      backend: "codex",
      profileId: undefined,
      model: "gpt-4.1",
      cwd: "/tmp/repo",
      yes: true,
      persistSelection: true,
      passthroughArgs: [],
    });
  });
});
