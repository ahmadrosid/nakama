import { describe, expect, test } from "bun:test";
import type { ToolCall, ToolDefinition } from "@nakama/core";
import { canRunToolCallsInParallel, executeToolCall } from "./tool-loop";

const sampleTool: ToolDefinition = {
  name: "sample",
  description: "Sample tool for tests",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
  },
  run(input) {
    return Promise.resolve(input);
  },
};

describe("tool-loop", () => {
  test("canRunToolCallsInParallel requires more than one parallelSafe tool", () => {
    const parallelTool: ToolDefinition = { ...sampleTool, parallelSafe: true };
    const sequentialTool: ToolDefinition = { ...sampleTool, name: "sequential" };

    expect(canRunToolCallsInParallel([parallelTool], [{ id: "1", name: "sample", arguments: {} }])).toBe(
      false,
    );
    expect(
      canRunToolCallsInParallel(
        [parallelTool],
        [
          { id: "1", name: "sample", arguments: {} },
          { id: "2", name: "sample", arguments: {} },
        ],
      ),
    ).toBe(true);
    expect(
      canRunToolCallsInParallel(
        [parallelTool, sequentialTool],
        [
          { id: "1", name: "sample", arguments: {} },
          { id: "2", name: "sequential", arguments: {} },
        ],
      ),
    ).toBe(false);
  });

  test("executeToolCall runs a known tool", async () => {
    const result = await executeToolCall([sampleTool], {
      id: "call_1",
      name: "sample",
      arguments: { message: "hello" },
    });

    expect(result).toEqual({ message: "hello" });
  });

  test("executeToolCall returns an error for unknown tools", async () => {
    const result = await executeToolCall([sampleTool], {
      id: "call_2",
      name: "missing",
      arguments: {},
    });

    expect(result).toEqual({ error: "Unknown tool: missing" });
  });

  test("executeToolCall catches handler errors", async () => {
    const failingTool: ToolDefinition = {
      name: "fail",
      description: "Always fails",
      async run() {
        throw new Error("boom");
      },
    };

    const result = await executeToolCall([failingTool], {
      id: "call_3",
      name: "fail",
      arguments: {},
    });

    expect(result).toEqual({ error: "boom" });
  });
});
