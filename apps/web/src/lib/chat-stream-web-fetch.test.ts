import { describe, expect, test } from "bun:test";
import type { ChatListItem } from "./chat-history";
import {
  buildWebFetchToolState,
  formatWebFetchHeaderText,
  isWebFetchTool,
  parseExaWebFetchTextResult,
  parseWebFetchSourcesFromResult,
  parseWebFetchUrls,
  shouldRenderWebFetchToolRow,
} from "./chat-stream-web-fetch";
import { parseWebSearchSourcesFromResult } from "./chat-stream-web-search";

describe("chat-stream-web-fetch", () => {
  test("isWebFetchTool matches builtin and Exa MCP names", () => {
    expect(isWebFetchTool("web_fetch")).toBe(true);
    expect(isWebFetchTool("exa__web_fetch_exa")).toBe(true);
    expect(isWebFetchTool("exa__web_search_exa")).toBe(false);
    expect(isWebFetchTool("web_search")).toBe(false);
  });

  test("parseWebFetchUrls reads url and urls array", () => {
    expect(parseWebFetchUrls({ url: "https://example.com/a" })).toEqual([
      "https://example.com/a",
    ]);
    expect(
      parseWebFetchUrls({
        urls: ["https://example.com/a", "https://example.org/b"],
      }),
    ).toEqual(["https://example.com/a", "https://example.org/b"]);
  });

  test("formatWebFetchHeaderText uses hostname or page count", () => {
    expect(formatWebFetchHeaderText(["https://docs.example.com/guide"])).toBe(
      "docs.example.com/guide",
    );
    expect(
      formatWebFetchHeaderText([
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ]),
    ).toBe("3 pages");
  });

  test("parseExaWebFetchTextResult handles markdown crawl blocks", () => {
    const text = [
      "# Nakama Docs",
      "URL: https://ahmadrosid.github.io/nakama/getting-started.md",
      "Published: 2026-01-01",
      "Author: Nakama",
      "",
      "Getting started content…",
      "",
      "# Telegram",
      "URL: https://ahmadrosid.github.io/nakama/telegram.md",
      "",
      "Telegram setup content…",
    ].join("\n");

    const sources = parseExaWebFetchTextResult(text);

    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      title: "Nakama Docs",
      href: "https://ahmadrosid.github.io/nakama/getting-started.md",
    });
    expect(sources[1]?.title).toBe("Telegram");
  });

  test("parseWebFetchSourcesFromResult handles builtin web_fetch JSON", () => {
    const sources = parseWebFetchSourcesFromResult({
      url: "https://example.com/start",
      finalUrl: "https://example.com/final",
      status: 200,
      contentType: "text/html",
      bytes: 1200,
      content: "# Hello",
    });

    expect(sources).toEqual([
      {
        title: "example.com/final",
        url: "https://example.com/final",
        href: "https://example.com/final",
      },
    ]);
  });

  test("parseWebFetchSourcesFromResult handles Exa MCP wrapper", () => {
    const sources = parseWebFetchSourcesFromResult({
      text: "# Report\nURL: https://example.com/report\n\nBody text",
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.title).toBe("Report");
  });

  test("search parser does not consume Exa fetch markdown", () => {
    const fetchText = "# Report\nURL: https://example.com/report\n\nBody";
    expect(parseWebSearchSourcesFromResult({ text: fetchText })).toEqual([]);
    expect(parseWebFetchSourcesFromResult({ text: fetchText })).toHaveLength(1);
  });

  test("buildWebFetchToolState uses input URLs while running", () => {
    const running: ChatListItem = {
      id: "tool_1",
      role: "tool",
      content: "web_fetch",
      tool: "web_fetch",
      toolStatus: "running",
      toolInput: { url: "https://example.com/page" },
    };

    expect(buildWebFetchToolState(running)).toMatchObject({
      headerText: "example.com/page",
      status: "running",
    });
    expect(buildWebFetchToolState(running).sources).toHaveLength(1);
  });

  test("shouldRenderWebFetchToolRow shows running fetch and hides failed empty results", () => {
    const running: ChatListItem = {
      id: "tool_1",
      role: "tool",
      content: "web_fetch",
      tool: "web_fetch",
      toolStatus: "running",
      toolInput: { url: "https://example.com" },
    };

    expect(shouldRenderWebFetchToolRow(running)).toBe(true);

    const failed: ChatListItem = {
      id: "tool_2",
      role: "tool",
      content: "web_fetch completed",
      tool: "exa__web_fetch_exa",
      toolStatus: "done",
      toolResult: { error: "MCP server disconnected" },
    };

    expect(shouldRenderWebFetchToolRow(failed)).toBe(false);
  });
});

describe("buildStreamHandlers web_fetch lifecycle", () => {
  test("onToolStart and onToolEnd work for builtin and Exa fetch tools", async () => {
    const { buildStreamHandlers } = await import("./chat-stream");
    let messages: ChatListItem[] = [];

    const handlers = buildStreamHandlers((updater) => {
      messages = typeof updater === "function" ? updater(messages) : updater;
    });

    handlers.onToolStart?.({
      toolCallId: "fetch_1",
      tool: "web_fetch",
      input: { url: "https://example.com/docs" },
    });

    expect(messages[0]).toMatchObject({
      tool: "web_fetch",
      toolStatus: "running",
    });

    handlers.onToolEnd?.({
      toolCallId: "fetch_1",
      tool: "web_fetch",
      result: {
        url: "https://example.com/docs",
        finalUrl: "https://example.com/docs",
        status: 200,
        content: "# Docs",
        contentType: "text/markdown",
        bytes: 10,
      },
    });

    expect(parseWebFetchSourcesFromResult(messages[0]?.toolResult)).toHaveLength(1);

    handlers.onToolStart?.({
      toolCallId: "fetch_2",
      tool: "exa__web_fetch_exa",
      input: { urls: ["https://a.test", "https://b.test"] },
    });

    handlers.onToolEnd?.({
      toolCallId: "fetch_2",
      tool: "exa__web_fetch_exa",
      result: {
        text: "# A\nURL: https://a.test\n\nA body\n\n# B\nURL: https://b.test\n\nB body",
      },
    });

    expect(parseWebFetchSourcesFromResult(messages[1]?.toolResult)).toHaveLength(2);
  });
});
