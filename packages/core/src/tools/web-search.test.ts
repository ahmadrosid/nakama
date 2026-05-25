import { describe, expect, test } from "bun:test";
import { webSearchTool } from "./web-search";

describe("web_search tool", () => {
  test("cannot be executed locally", async () => {
    await expect(webSearchTool.run({ query: "latest news" }, {})).rejects.toThrow(
      "provider",
    );
  });
});
