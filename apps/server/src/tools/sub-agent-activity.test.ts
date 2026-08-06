import { describe, expect, test } from "bun:test";
import { formatToolActivityLabel } from "./sub-agent-activity";

describe("formatToolActivityLabel", () => {
  test("formats common read/search/fetch tools", () => {
    expect(formatToolActivityLabel("read_file", { path: "SOUL.md" })).toBe("Reading SOUL.md");
    expect(formatToolActivityLabel("search_files", { query: "TODO" })).toBe(
      "Searching · TODO",
    );
    expect(formatToolActivityLabel("knowledge_base_search", { query: "pricing" })).toBe(
      "Searching docs · pricing",
    );
    expect(formatToolActivityLabel("web_fetch", { url: "https://example.com/docs" })).toBe(
      "Fetching example.com",
    );
    expect(formatToolActivityLabel("web_search", { query: "React 19" })).toBe(
      "Searching web · React 19",
    );
  });

  test("falls back to tool name", () => {
    expect(formatToolActivityLabel("custom_tool", {})).toBe("Using custom_tool");
  });
});
