import { describe, expect, test } from "bun:test";
import {
  buildWebSearchToolState,
  extractWebSearchBlocksFromProviderContent,
  isWebSearchTool,
  parseWebSearchQuery,
  parseWebSearchSourcesFromResult,
} from "./chat-stream-web-search";
import type { ChatListItem } from "./chat-history";

describe("chat-stream-web-search", () => {
  test("isWebSearchTool matches name", () => {
    expect(isWebSearchTool("web_search")).toBe(true);
    expect(isWebSearchTool("exa__web_search_exa")).toBe(true);
    expect(isWebSearchTool("exa__web_search_advanced_exa")).toBe(true);
    expect(isWebSearchTool("exa__web_fetch_exa")).toBe(false);
    expect(isWebSearchTool("web_fetch")).toBe(false);
    expect(isWebSearchTool("search_files")).toBe(false);
  });

  test("parseWebSearchQuery reads query and queries array", () => {
    expect(parseWebSearchQuery({ query: "  jwt security  " })).toBe("jwt security");
    expect(parseWebSearchQuery({ queries: ["first", "second"] })).toBe("first");
    expect(parseWebSearchQuery({})).toBeNull();
  });

  test("parseWebSearchSourcesFromResult handles Anthropic content array", () => {
    const sources = parseWebSearchSourcesFromResult([
      {
        type: "web_search_result",
        title: "JWT best practices",
        url: "https://auth0.com/blog/jwt-security-best-practices",
      },
      {
        type: "web_search_result",
        title: "OWASP guide",
        url: "https://owasp.org/www-project-nodejs-goat",
      },
    ]);

    expect(sources).toEqual([
      {
        title: "JWT best practices",
        url: "https://auth0.com/blog/jwt-security-best-practices",
        href: "https://auth0.com/blog/jwt-security-best-practices",
      },
      {
        title: "OWASP guide",
        url: "https://owasp.org/www-project-nodejs-goat",
        href: "https://owasp.org/www-project-nodejs-goat",
      },
    ]);
  });

  test("parseWebSearchSourcesFromResult handles Exa MCP formatted text", () => {
    const text = [
      "Title: JWT Security Best Practices",
      "URL: https://auth0.com/blog/jwt-security-best-practices",
      "Published: 2024-01-01",
      "Author: Auth0",
      "Highlights:",
      "Use strong signing keys.",
      "",
      "---",
      "",
      "Title: OWASP Node.js Guide",
      "URL: https://owasp.org/www-project-nodejs-goat",
      "Published: N/A",
      "Author: OWASP",
    ].join("\n");

    const sources = parseWebSearchSourcesFromResult({ text });

    expect(sources).toEqual([
      {
        title: "JWT Security Best Practices",
        url: "https://auth0.com/blog/jwt-security-best-practices",
        href: "https://auth0.com/blog/jwt-security-best-practices",
      },
      {
        title: "OWASP Node.js Guide",
        url: "https://owasp.org/www-project-nodejs-goat",
        href: "https://owasp.org/www-project-nodejs-goat",
      },
    ]);
  });

  test("parseWebSearchSourcesFromResult handles Exa MCP content wrapper", () => {
    const sources = parseWebSearchSourcesFromResult({
      content: [
        {
          type: "text",
          text: "Title: Example\nURL: https://example.com/article\nPublished: N/A\nAuthor: N/A",
        },
      ],
      text: "Title: Example\nURL: https://example.com/article\nPublished: N/A\nAuthor: N/A",
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.title).toBe("Example");
    expect(sources[0]?.href).toBe("https://example.com/article");
  });

  test("parseWebSearchSourcesFromResult handles OpenAI action sources", () => {
    const sources = parseWebSearchSourcesFromResult({
      type: "search",
      query: "latest AI news",
      sources: [
        { type: "url", url: "https://example.com/news" },
        { type: "url", url: "https://example.org/report" },
      ],
    });

    expect(sources).toHaveLength(2);
    expect(sources[0]?.title).toBe("https://example.com/news");
    expect(sources[0]?.href).toBe("https://example.com/news");
  });

  test("parseWebSearchSourcesFromResult returns empty for malformed payloads", () => {
    expect(parseWebSearchSourcesFromResult(null)).toEqual([]);
    expect(parseWebSearchSourcesFromResult({ unexpected: true })).toEqual([]);
  });

  test("extractWebSearchBlocksFromProviderContent pairs Anthropic blocks", () => {
    const blocks = extractWebSearchBlocksFromProviderContent([
      {
        type: "server_tool_use",
        id: "srvtool_1",
        name: "web_search",
        input: { query: "jwt middleware" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtool_1",
        content: [
          {
            type: "web_search_result",
            title: "JWT middleware",
            url: "https://example.com/jwt",
          },
        ],
      },
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      toolCallId: "srvtool_1",
      query: "jwt middleware",
    });
    expect(parseWebSearchSourcesFromResult(blocks[0]?.result)).toHaveLength(1);
  });

  test("extractWebSearchBlocksFromProviderContent collects OpenAI web_search_call items", () => {
    const blocks = extractWebSearchBlocksFromProviderContent([
      {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: {
          type: "search",
          query: "semaglutide diabetes",
          sources: [{ type: "url", url: "https://pubmed.ncbi.nlm.nih.gov/example" }],
        },
      },
    ]);

    expect(blocks).toEqual([
      {
        toolCallId: "ws_1",
        query: "semaglutide diabetes",
        result: {
          type: "search",
          query: "semaglutide diabetes",
          sources: [{ type: "url", url: "https://pubmed.ncbi.nlm.nih.gov/example" }],
        },
      },
    ]);
  });

  test("extractWebSearchBlocksFromProviderContent returns one state per toolCallId", () => {
    const blocks = extractWebSearchBlocksFromProviderContent([
      {
        type: "server_tool_use",
        id: "a",
        name: "web_search",
        input: { query: "one" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "a",
        content: [{ type: "web_search_result", title: "One", url: "https://one.test" }],
      },
      {
        type: "server_tool_use",
        id: "b",
        name: "web_search",
        input: { query: "two" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "b",
        content: [{ type: "web_search_result", title: "Two", url: "https://two.test" }],
      },
    ]);

    expect(blocks.map((block) => block.toolCallId)).toEqual(["a", "b"]);
  });

  test("buildWebSearchToolState combines query, sources, and status", () => {
    const running: ChatListItem = {
      id: "tool_1",
      role: "tool",
      content: "web_search",
      tool: "web_search",
      toolStatus: "running",
      toolInput: { query: "running query" },
    };

    expect(buildWebSearchToolState(running)).toEqual({
      query: "running query",
      sources: [],
      status: "running",
    });

    const done: ChatListItem = {
      id: "tool_2",
      role: "tool",
      content: "web_search completed",
      tool: "web_search",
      toolStatus: "done",
      toolInput: { query: "done query" },
      toolResult: [
        {
          type: "web_search_result",
          title: "Result",
          url: "https://example.com",
        },
      ],
    };

    expect(buildWebSearchToolState(done)).toMatchObject({
      query: "done query",
      status: "done",
    });
    expect(buildWebSearchToolState(done).sources).toHaveLength(1);
  });
});

describe("buildStreamHandlers web_search lifecycle", () => {
  test("onToolStart and onToolEnd produce expected ChatListItem fields", async () => {
    const { buildStreamHandlers } = await import("./chat-stream");
    let messages: ChatListItem[] = [];

    const handlers = buildStreamHandlers((updater) => {
      messages = typeof updater === "function" ? updater(messages) : updater;
    });

    handlers.onToolStart?.({
      toolCallId: "ws_test",
      tool: "web_search",
      input: { query: "test query" },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "tool",
      tool: "web_search",
      toolStatus: "running",
      toolInput: { query: "test query" },
      toolCallId: "ws_test",
    });

    handlers.onToolEnd?.({
      toolCallId: "ws_test",
      tool: "web_search",
      result: {
        type: "search",
        query: "test query",
        sources: [{ type: "url", url: "https://example.com/article" }],
      },
    });

    expect(messages[0]).toMatchObject({
      toolStatus: "done",
      content: "web_search completed",
    });
    expect(parseWebSearchSourcesFromResult(messages[0]?.toolResult)).toHaveLength(1);
  });

  test("onToolStart and onToolEnd work for Exa MCP web search tools", async () => {
    const { buildStreamHandlers } = await import("./chat-stream");
    let messages: ChatListItem[] = [];

    const handlers = buildStreamHandlers((updater) => {
      messages = typeof updater === "function" ? updater(messages) : updater;
    });

    handlers.onToolStart?.({
      toolCallId: "tool_exa_1",
      tool: "exa__web_search_exa",
      input: { query: "JWT middleware security" },
    });

    expect(messages[0]).toMatchObject({
      tool: "exa__web_search_exa",
      toolStatus: "running",
      toolInput: { query: "JWT middleware security" },
    });

    handlers.onToolEnd?.({
      toolCallId: "tool_exa_1",
      tool: "exa__web_search_exa",
      result: {
        text: "Title: JWT Guide\nURL: https://example.com/jwt\nPublished: N/A\nAuthor: N/A",
      },
    });

    expect(messages[0]).toMatchObject({
      toolStatus: "done",
    });
    expect(parseWebSearchSourcesFromResult(messages[0]?.toolResult)).toHaveLength(1);
  });
});
