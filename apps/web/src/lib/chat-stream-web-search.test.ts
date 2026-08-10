import { describe, expect, test } from "bun:test";
import type { ChatListItem } from "./chat-history";
import {
  buildWebSearchToolState,
  extractWebSearchBlocksFromProviderContent,
  isWebSearchTool,
  parseWebSearchQuery,
  parseWebSearchSourcesFromResult,
} from "./chat-stream-web-search";

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
    expect(parseWebSearchQuery({ query: "  jwt security  " })).toBe(
      "jwt security"
    );
    expect(parseWebSearchQuery({ queries: ["first", "second"] })).toBe("first");
    expect(parseWebSearchQuery({})).toBeNull();
  });

  test("parseWebSearchSourcesFromResult handles Anthropic content array", () => {
    const sources = parseWebSearchSourcesFromResult([
      {
        title: "JWT best practices",
        type: "web_search_result",
        url: "https://auth0.com/blog/jwt-security-best-practices",
      },
      {
        title: "OWASP guide",
        type: "web_search_result",
        url: "https://owasp.org/www-project-nodejs-goat",
      },
    ]);

    expect(sources).toEqual([
      {
        href: "https://auth0.com/blog/jwt-security-best-practices",
        title: "JWT best practices",
        url: "https://auth0.com/blog/jwt-security-best-practices",
      },
      {
        href: "https://owasp.org/www-project-nodejs-goat",
        title: "OWASP guide",
        url: "https://owasp.org/www-project-nodejs-goat",
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
        href: "https://auth0.com/blog/jwt-security-best-practices",
        title: "JWT Security Best Practices",
        url: "https://auth0.com/blog/jwt-security-best-practices",
      },
      {
        href: "https://owasp.org/www-project-nodejs-goat",
        title: "OWASP Node.js Guide",
        url: "https://owasp.org/www-project-nodejs-goat",
      },
    ]);
  });

  test("parseWebSearchSourcesFromResult handles Exa MCP content wrapper", () => {
    const sources = parseWebSearchSourcesFromResult({
      content: [
        {
          text: "Title: Example\nURL: https://example.com/article\nPublished: N/A\nAuthor: N/A",
          type: "text",
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
      query: "latest AI news",
      sources: [
        { type: "url", url: "https://example.com/news" },
        { type: "url", url: "https://example.org/report" },
      ],
      type: "search",
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
        id: "srvtool_1",
        input: { query: "jwt middleware" },
        name: "web_search",
        type: "server_tool_use",
      },
      {
        content: [
          {
            title: "JWT middleware",
            type: "web_search_result",
            url: "https://example.com/jwt",
          },
        ],
        tool_use_id: "srvtool_1",
        type: "web_search_tool_result",
      },
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      query: "jwt middleware",
      toolCallId: "srvtool_1",
    });
    expect(parseWebSearchSourcesFromResult(blocks[0]?.result)).toHaveLength(1);
  });

  test("extractWebSearchBlocksFromProviderContent collects OpenAI web_search_call items", () => {
    const blocks = extractWebSearchBlocksFromProviderContent([
      {
        action: {
          query: "semaglutide diabetes",
          sources: [
            { type: "url", url: "https://pubmed.ncbi.nlm.nih.gov/example" },
          ],
          type: "search",
        },
        id: "ws_1",
        status: "completed",
        type: "web_search_call",
      },
    ]);

    expect(blocks).toEqual([
      {
        query: "semaglutide diabetes",
        result: {
          query: "semaglutide diabetes",
          sources: [
            { type: "url", url: "https://pubmed.ncbi.nlm.nih.gov/example" },
          ],
          type: "search",
        },
        toolCallId: "ws_1",
      },
    ]);
  });

  test("extractWebSearchBlocksFromProviderContent returns one state per toolCallId", () => {
    const blocks = extractWebSearchBlocksFromProviderContent([
      {
        id: "a",
        input: { query: "one" },
        name: "web_search",
        type: "server_tool_use",
      },
      {
        content: [
          { title: "One", type: "web_search_result", url: "https://one.test" },
        ],
        tool_use_id: "a",
        type: "web_search_tool_result",
      },
      {
        id: "b",
        input: { query: "two" },
        name: "web_search",
        type: "server_tool_use",
      },
      {
        content: [
          { title: "Two", type: "web_search_result", url: "https://two.test" },
        ],
        tool_use_id: "b",
        type: "web_search_tool_result",
      },
    ]);

    expect(blocks.map((block) => block.toolCallId)).toEqual(["a", "b"]);
  });

  test("buildWebSearchToolState combines query, sources, and status", () => {
    const running: ChatListItem = {
      content: "web_search",
      id: "tool_1",
      role: "tool",
      tool: "web_search",
      toolInput: { query: "running query" },
      toolStatus: "running",
    };

    expect(buildWebSearchToolState(running)).toEqual({
      query: "running query",
      sources: [],
      status: "running",
    });

    const done: ChatListItem = {
      content: "web_search completed",
      id: "tool_2",
      role: "tool",
      tool: "web_search",
      toolInput: { query: "done query" },
      toolResult: [
        {
          title: "Result",
          type: "web_search_result",
          url: "https://example.com",
        },
      ],
      toolStatus: "done",
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
      input: { query: "test query" },
      tool: "web_search",
      toolCallId: "ws_test",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "tool",
      tool: "web_search",
      toolCallId: "ws_test",
      toolInput: { query: "test query" },
      toolStatus: "running",
    });

    handlers.onToolEnd?.({
      result: {
        query: "test query",
        sources: [{ type: "url", url: "https://example.com/article" }],
        type: "search",
      },
      tool: "web_search",
      toolCallId: "ws_test",
    });

    expect(messages[0]).toMatchObject({
      content: "web_search completed",
      toolStatus: "done",
    });
    expect(
      parseWebSearchSourcesFromResult(messages[0]?.toolResult)
    ).toHaveLength(1);
  });

  test("onToolStart and onToolEnd work for Exa MCP web search tools", async () => {
    const { buildStreamHandlers } = await import("./chat-stream");
    let messages: ChatListItem[] = [];

    const handlers = buildStreamHandlers((updater) => {
      messages = typeof updater === "function" ? updater(messages) : updater;
    });

    handlers.onToolStart?.({
      input: { query: "JWT middleware security" },
      tool: "exa__web_search_exa",
      toolCallId: "tool_exa_1",
    });

    expect(messages[0]).toMatchObject({
      tool: "exa__web_search_exa",
      toolInput: { query: "JWT middleware security" },
      toolStatus: "running",
    });

    handlers.onToolEnd?.({
      result: {
        text: "Title: JWT Guide\nURL: https://example.com/jwt\nPublished: N/A\nAuthor: N/A",
      },
      tool: "exa__web_search_exa",
      toolCallId: "tool_exa_1",
    });

    expect(messages[0]).toMatchObject({
      toolStatus: "done",
    });
    expect(
      parseWebSearchSourcesFromResult(messages[0]?.toolResult)
    ).toHaveLength(1);
  });
});
