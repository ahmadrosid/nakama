import { describe, expect, test } from "bun:test";
import { WEB_SEARCH_TOOL_NAME, webSearchTool } from "./web-search";

describe("web_search tool", () => {
  test("uses the shared tool name constant", () => {
    expect(WEB_SEARCH_TOOL_NAME).toBe("web_search");
  });

  test("cannot be executed locally", async () => {
    await expect(webSearchTool.run({ query: "latest news" }, {})).rejects.toThrow(
      "provider",
    );
  });
});
