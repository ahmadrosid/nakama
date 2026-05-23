import { describe, expect, test } from "bun:test";
import type { ToolDefinition } from "@tinyclaw/core";
import { executeToolCall, findTool, serializeToolResult } from "./tool-loop";

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
  test("findTool returns a matching tool", () => {
    expect(findTool([sampleTool], "sample")).toBe(sampleTool);
    expect(findTool([sampleTool], "missing")).toBeUndefined();
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

  test("serializeToolResult returns JSON", () => {
    expect(serializeToolResult({ ok: true })).toBe('{"ok":true}');
  });
});
