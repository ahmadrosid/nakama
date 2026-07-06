import { describe, expect, test } from "bun:test";
import type { ToolDefinition } from "@nakama/core";
import { emailTool } from "@nakama/core/tools/email";
import { omitUnavailableBuiltinTools } from "./tool-resolver";

const webSearchTool: ToolDefinition = {
  name: "web_search",
  description: "Search the web",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async run() {
    return { ok: true };
  },
};

describe("omitUnavailableBuiltinTools", () => {
  test("drops email when mailbox is not configured", () => {
    const tools = [webSearchTool, emailTool];

    expect(omitUnavailableBuiltinTools(tools, false).map((tool) => tool.name)).toEqual([
      "web_search",
    ]);
    expect(omitUnavailableBuiltinTools(tools, true).map((tool) => tool.name)).toEqual([
      "web_search",
      "email",
    ]);
  });
});
