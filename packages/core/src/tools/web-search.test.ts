import { describe, expect, test } from "bun:test";
import type { ToolDefinition } from "../contract";
import { partitionTools, webSearchTool } from "./web-search";

const writeFileTool: ToolDefinition = {
  description: "Write a file",
  name: "write_file",
  run() {
    return Promise.resolve({});
  },
};

describe("web_search tool", () => {
  test("cannot be executed locally", async () => {
    await expect(
      webSearchTool.run({ query: "latest news" }, {})
    ).rejects.toThrow("provider");
  });
});

describe("partitionTools", () => {
  test("separates web_search from local tools", () => {
    expect(partitionTools([writeFileTool, webSearchTool])).toEqual({
      hasWebSearch: true,
      localTools: [writeFileTool],
    });
  });

  test("returns empty local tools when only web_search is assigned", () => {
    expect(partitionTools([webSearchTool])).toEqual({
      hasWebSearch: true,
      localTools: [],
    });
  });

  test("keeps a custom-backed web_search local so the provider does not search", () => {
    const customWebSearch: ToolDefinition = {
      description: "Search via a configured endpoint",
      hosted: false,
      name: "web_search",
      run() {
        return Promise.resolve({});
      },
    };

    expect(partitionTools([writeFileTool, customWebSearch])).toEqual({
      hasWebSearch: false,
      localTools: [writeFileTool, customWebSearch],
    });
  });
});
