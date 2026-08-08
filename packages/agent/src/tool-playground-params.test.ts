import { describe, expect, test } from "bun:test";
import {
  parseSuggestedParams,
  suggestToolParamsFromPrompt,
} from "./tool-playground-params";

describe("tool playground params", () => {
  test("parseSuggestedParams accepts plain JSON and fenced JSON", () => {
    expect(parseSuggestedParams('{"query":"hi"}')).toEqual({ query: "hi" });
    expect(parseSuggestedParams('```json\n{"query":"hi"}\n```')).toEqual({
      query: "hi",
    });
    expect(parseSuggestedParams("not json")).toBeNull();
  });

  test("suggestToolParamsFromPrompt requires prompt", async () => {
    await expect(
      suggestToolParamsFromPrompt(
        { description: "Echo", prompt: "   ", toolName: "echo" },
        {}
      )
    ).rejects.toThrow("Prompt is required.");
  });

  test("suggestToolParamsFromPrompt returns {} without provider", async () => {
    const result = await suggestToolParamsFromPrompt(
      { description: "Echo", prompt: "test", toolName: "echo" },
      {}
    );

    expect(result).toEqual({});
  });

  test("suggestToolParamsFromPrompt unwraps provider JSON output", async () => {
    const result = await suggestToolParamsFromPrompt(
      { description: "Echo", prompt: "test", toolName: "echo" },
      {
        provider: {
          generateText: async () => '{"query":"nakama"}',
        } as never,
      }
    );

    expect(result).toEqual({ query: "nakama" });
  });
});
