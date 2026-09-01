import { describe, expect, spyOn, test } from "bun:test";
import type { ToolDefinition } from "@nakama/core";
import * as core from "@nakama/core";
import { canRunToolCallsInParallel, executeToolCall } from "./tool-loop";

const sampleTool: ToolDefinition = {
  description: "Sample tool for tests",
  name: "sample",
  parameters: {
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
    type: "object",
  },
  run(input) {
    return Promise.resolve(input);
  },
};

describe("tool-loop", () => {
  test("canRunToolCallsInParallel requires more than one parallelSafe tool", () => {
    const parallelTool: ToolDefinition = { ...sampleTool, parallelSafe: true };
    const sequentialTool: ToolDefinition = {
      ...sampleTool,
      name: "sequential",
    };

    expect(
      canRunToolCallsInParallel(
        [parallelTool],
        [{ arguments: {}, id: "1", name: "sample" }]
      )
    ).toBe(false);
    expect(
      canRunToolCallsInParallel(
        [parallelTool],
        [
          { arguments: {}, id: "1", name: "sample" },
          { arguments: {}, id: "2", name: "sample" },
        ]
      )
    ).toBe(true);
    expect(
      canRunToolCallsInParallel(
        [parallelTool, sequentialTool],
        [
          { arguments: {}, id: "1", name: "sample" },
          { arguments: {}, id: "2", name: "sequential" },
        ]
      )
    ).toBe(false);
  });

  test("executeToolCall returns an error for unknown tools", async () => {
    const result = await executeToolCall([sampleTool], {
      arguments: {},
      id: "call_2",
      name: "missing",
    });

    expect(result).toEqual({ error: "Unknown tool: missing" });
  });

  test("executeToolCall catches handler errors", async () => {
    const failingTool: ToolDefinition = {
      description: "Always fails",
      name: "fail",
      async run() {
        throw new Error("boom");
      },
    };

    const result = await executeToolCall([failingTool], {
      arguments: {},
      id: "call_3",
      name: "fail",
    });

    expect(result).toEqual({ error: "boom" });
  });

  test("executeToolCall returns raw result when distillToolResult throws", async () => {
    const payload = { message: "kept" };
    const spy = spyOn(core, "distillToolResult").mockImplementation(
      async () => {
        throw new Error("omni unavailable");
      }
    );
    const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const result = await executeToolCall([sampleTool], {
        arguments: payload,
        id: "call_4",
        name: "sample",
      });

      expect(result).toEqual(payload);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
