import { describe, expect, test } from "bun:test";
import {
  buildSuggestParamsUserPrompt,
  parseSuggestedParams,
  suggestToolParamsFromPrompt,
} from "./tool-playground-params";

describe("tool playground params", () => {
  test("buildSuggestParamsUserPrompt includes tool context", () => {
    const prompt = buildSuggestParamsUserPrompt({
      toolName: "echo",
      description: "Echo input",
      parameters: { type: "object", properties: { query: { type: "string" } } },
      prompt: "test with hello",
    });

    expect(prompt).toContain("Tool: echo");
    expect(prompt).toContain("test with hello");
    expect(prompt).toContain("Parameter schema:");
  });

  test("parseSuggestedParams accepts plain JSON and fenced JSON", () => {
    expect(parseSuggestedParams('{"query":"hi"}')).toEqual({ query: "hi" });
    expect(parseSuggestedParams('```json\n{"query":"hi"}\n```')).toEqual({ query: "hi" });
    expect(parseSuggestedParams("not json")).toBeNull();
  });

  test("suggestToolParamsFromPrompt requires prompt", async () => {
    await expect(
      suggestToolParamsFromPrompt(
        { toolName: "echo", description: "Echo", prompt: "   " },
        {},
      ),
    ).rejects.toThrow("Prompt is required.");
  });

  test("suggestToolParamsFromPrompt returns {} without provider", async () => {
    const result = await suggestToolParamsFromPrompt(
      { toolName: "echo", description: "Echo", prompt: "test" },
      {},
    );

    expect(result).toEqual({});
  });

  test("suggestToolParamsFromPrompt unwraps provider JSON output", async () => {
    const result = await suggestToolParamsFromPrompt(
      { toolName: "echo", description: "Echo", prompt: "test" },
      {
        provider: {
          generateText: async () => '{"query":"nakama"}',
        } as never,
      },
    );

    expect(result).toEqual({ query: "nakama" });
  });
});
