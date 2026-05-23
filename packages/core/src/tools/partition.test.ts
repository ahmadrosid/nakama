import { describe, expect, test } from "bun:test";
import type { ToolDefinition } from "../contract";
import { partitionTools } from "./partition";
import { WEB_SEARCH_TOOL_NAME, webSearchTool } from "./web-search";

const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write a file",
  run() {
    return Promise.resolve({});
  },
};

describe("partitionTools", () => {
  test("separates web_search from local tools", () => {
    expect(partitionTools([writeFileTool, webSearchTool])).toEqual({
      localTools: [writeFileTool],
      hasWebSearch: true,
    });
  });

  test("returns empty local tools when only web_search is assigned", () => {
    expect(partitionTools([webSearchTool])).toEqual({
      localTools: [],
      hasWebSearch: true,
    });
  });

  test("uses the shared web_search tool name constant", () => {
    expect(WEB_SEARCH_TOOL_NAME).toBe("web_search");
  });
});
