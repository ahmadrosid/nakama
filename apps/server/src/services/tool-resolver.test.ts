import { describe, expect, test } from "bun:test";
import type { ToolDefinition } from "@nakama/core";
import {
  CRASH_ISSUE_TOOL_NAME,
  crashIssueTool,
} from "@nakama/core/tools/crash-issue";
import { emailTool } from "@nakama/core/tools/email";
import { omitUnavailableBuiltinTools } from "./tool-resolver";

const webSearchTool: ToolDefinition = {
  description: "Search the web",
  name: "web_search",
  parameters: { additionalProperties: false, properties: {}, type: "object" },
  async run() {
    return { ok: true };
  },
};

describe("omitUnavailableBuiltinTools", () => {
  test("drops email when mailbox is not configured", () => {
    const tools = [webSearchTool, emailTool];

    expect(
      omitUnavailableBuiltinTools(tools, false).map((tool) => tool.name)
    ).toEqual(["web_search"]);
    expect(
      omitUnavailableBuiltinTools(tools, true).map((tool) => tool.name)
    ).toEqual(["web_search", "email"]);
  });

  test("drops crash_issue unless a repository is configured", () => {
    const tools = [webSearchTool, crashIssueTool];

    // Absent by default: only the maintainer of the reported-on repo holds a token, so
    // every other install must never be handed a tool that can open issues.
    expect(
      omitUnavailableBuiltinTools(tools, true).map((tool) => tool.name)
    ).toEqual(["web_search"]);
    expect(
      omitUnavailableBuiltinTools(tools, true, false).map((tool) => tool.name)
    ).toEqual(["web_search"]);
    expect(
      omitUnavailableBuiltinTools(tools, true, true).map((tool) => tool.name)
    ).toEqual(["web_search", CRASH_ISSUE_TOOL_NAME]);
  });
});
