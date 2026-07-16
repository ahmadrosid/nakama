import { describe, expect, test } from "bun:test";
import type { ChatMessage, SessionMessageMeta } from "@nakama/core/contract";
import { chatMessagesToListItems } from "./chat-history";
import { extractTurnArtifacts } from "./chat-artifacts";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("chatMessagesToListItems", () => {
  test("preserves history index and metadata for rendered items", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tool_1", name: "search_files", arguments: { path: "src" } }],
      },
      { role: "tool", toolCallId: "tool_1", name: "search_files", content: "{\"ok\":true}" },
      { role: "assistant", content: "Done" },
    ];
    const messageMeta: SessionMessageMeta[] = [
      { id: "msg_1", seq: 0, createdAt: "2026-06-14T10:00:00.000Z" },
      { id: "msg_2", seq: 1, createdAt: "2026-06-14T10:00:01.000Z" },
      { id: "msg_3", seq: 2, createdAt: "2026-06-14T10:00:02.000Z" },
      { id: "msg_4", seq: 3, createdAt: "2026-06-14T10:00:03.000Z" },
    ];

    const items = chatMessagesToListItems(messages, messageMeta);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      role: "user",
      historyIndex: 0,
      createdAt: "2026-06-14T10:00:00.000Z",
    });
    expect(items[1]).toMatchObject({
      role: "tool",
      historyIndex: 2,
      createdAt: "2026-06-14T10:00:02.000Z",
      toolInput: { path: "src" },
    });
    expect(items[2]).toMatchObject({
      role: "assistant",
      historyIndex: 3,
      createdAt: "2026-06-14T10:00:03.000Z",
      content: "Done",
    });
  });

  test("renders described images as attachments and keeps vision-native images inline", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "image",
            mediaType: "image/png",
            data: tinyPngBase64,
            description: "A red square.",
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Another one" },
          { type: "image", mediaType: "image/png", data: tinyPngBase64 },
        ],
      },
      {
        role: "user",
        content: "[Image]\nLegacy description only.",
      },
    ];

    const items = chatMessagesToListItems(messages);

    expect(items[0]).toMatchObject({
      content: "What is this?",
      imageAttachments: [
        {
          mediaType: "image/png",
          url: `data:image/png;base64,${tinyPngBase64}`,
          description: "A red square.",
        },
      ],
    });
    expect(items[0]?.images).toBeUndefined();
    expect(items[1]).toMatchObject({
      content: "Another one",
      images: [
        {
          mediaType: "image/png",
          url: `data:image/png;base64,${tinyPngBase64}`,
        },
      ],
    });
    expect(items[1]?.imageAttachments).toBeUndefined();
    expect(items[2]).toMatchObject({
      content: "",
      imageAttachments: [{ mediaType: "image/unknown", description: "Legacy description only." }],
    });
  });

  test("derives artifact refs from persisted write_file tool messages after hydration", () => {
    const artifactsRoot = "/Users/test/.nakama/orgs/org_1/profiles/profile_1/artifacts";
    const metaJson = JSON.stringify({
      mimeType: "text/markdown",
      savedAt: "2026-07-13T10:00:00.000Z",
      sizeBytes: 12,
    });
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "tool_content", name: "write_file", arguments: { path: "artifacts/report.md", content: "# Report" } },
          {
            id: "tool_meta",
            name: "write_file",
            arguments: { path: "artifacts/report.md.nakama-meta.json", content: metaJson },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "tool_content",
        name: "write_file",
        content: JSON.stringify({
          path: `${artifactsRoot}/report.md`,
          bytesWritten: 8,
        }),
      },
      {
        role: "tool",
        toolCallId: "tool_meta",
        name: "write_file",
        content: JSON.stringify({
          path: `${artifactsRoot}/report.md.nakama-meta.json`,
          bytesWritten: metaJson.length,
        }),
      },
      { role: "assistant", content: "Saved the report for you." },
    ];

    const items = chatMessagesToListItems(messages);
    const assistantTurnItems = items.filter((item) => item.role !== "user");
    const artifacts = extractTurnArtifacts(assistantTurnItems);

    expect(artifacts).toEqual([
      {
        filename: "report.md",
        path: "report.md",
        mimeType: "text/markdown",
        sizeBytes: 12,
        savedAt: "2026-07-13T10:00:00.000Z",
      },
    ]);
  });

  test("hydrates web_search tool rows from assistant providerContent", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Search the web for JWT security" },
      {
        role: "assistant",
        content: "Here is what I found about JWT security.",
        providerContent: [
          {
            type: "server_tool_use",
            id: "srvtool_abc",
            name: "web_search",
            input: { query: "JWT security best practices" },
          },
          {
            type: "web_search_tool_result",
            tool_use_id: "srvtool_abc",
            content: [
              {
                type: "web_search_result",
                title: "JWT Security Best Practices",
                url: "https://auth0.com/blog/jwt-security-best-practices",
              },
            ],
          },
        ],
      },
    ];

    const items = chatMessagesToListItems(messages);

    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({
      role: "tool",
      tool: "web_search",
      toolStatus: "done",
      toolCallId: "srvtool_abc",
      toolInput: { query: "JWT security best practices" },
    });
    expect(items[2]).toMatchObject({
      role: "assistant",
      content: "Here is what I found about JWT security.",
    });
  });

  test("does not duplicate web_search when a persisted tool row exists", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "Searching…",
        providerContent: [
          {
            type: "server_tool_use",
            id: "srvtool_abc",
            name: "web_search",
            input: { query: "JWT" },
          },
          {
            type: "web_search_tool_result",
            tool_use_id: "srvtool_abc",
            content: [
              {
                type: "web_search_result",
                title: "JWT",
                url: "https://example.com/jwt",
              },
            ],
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "srvtool_abc",
        name: "web_search",
        content: JSON.stringify([
          {
            type: "web_search_result",
            title: "JWT",
            url: "https://example.com/jwt",
          },
        ]),
      },
      { role: "assistant", content: "Done." },
    ];

    const items = chatMessagesToListItems(messages);
    const webSearchItems = items.filter((item) => item.tool === "web_search");

    expect(webSearchItems).toHaveLength(1);
    expect(webSearchItems[0]?.toolCallId).toBe("srvtool_abc");
    expect(webSearchItems[0]?.historyIndex).toBe(1);
  });

  test("does not duplicate web_search when assistant had only toolCalls", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "srvtool_abc", name: "web_search", arguments: { query: "JWT" } }],
        providerContent: [
          {
            type: "server_tool_use",
            id: "srvtool_abc",
            name: "web_search",
            input: { query: "JWT" },
          },
          {
            type: "web_search_tool_result",
            tool_use_id: "srvtool_abc",
            content: [
              {
                type: "web_search_result",
                title: "JWT",
                url: "https://example.com/jwt",
              },
            ],
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "srvtool_abc",
        name: "web_search",
        content: JSON.stringify([
          {
            type: "web_search_result",
            title: "JWT",
            url: "https://example.com/jwt",
          },
        ]),
      },
      { role: "assistant", content: "Done." },
    ];

    const items = chatMessagesToListItems(messages);
    const webSearchItems = items.filter((item) => item.tool === "web_search");

    expect(webSearchItems).toHaveLength(1);
    expect(webSearchItems[0]?.toolCallId).toBe("srvtool_abc");
  });

  test("preserves web_fetch tool rows from persisted tool messages", () => {
    const fetchResult = {
      url: "https://example.com/start",
      finalUrl: "https://example.com/docs",
      status: 200,
      contentType: "text/markdown",
      bytes: 42,
      content: "# Docs",
    };
    const messages: ChatMessage[] = [
      { role: "user", content: "Fetch the docs page" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tool_fetch_1",
            name: "web_fetch",
            arguments: { url: "https://example.com/docs" },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "tool_fetch_1",
        name: "web_fetch",
        content: JSON.stringify(fetchResult),
      },
      { role: "assistant", content: "Here is the page." },
    ];

    const items = chatMessagesToListItems(messages);

    expect(items.find((item) => item.tool === "web_fetch")).toMatchObject({
      role: "tool",
      toolStatus: "done",
      toolInput: { url: "https://example.com/docs" },
      toolResult: fetchResult,
    });
  });

  test("preserves Exa MCP web search tool rows from persisted tool messages", () => {
    const exaResult = {
      text: "Title: JWT Guide\nURL: https://example.com/jwt\nPublished: N/A\nAuthor: N/A",
    };
    const messages: ChatMessage[] = [
      { role: "user", content: "Search for JWT security" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tool_exa_1",
            name: "exa__web_search_exa",
            arguments: { query: "JWT security best practices" },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "tool_exa_1",
        name: "exa__web_search_exa",
        content: JSON.stringify(exaResult),
      },
      { role: "assistant", content: "Here is what I found." },
    ];

    const items = chatMessagesToListItems(messages);

    expect(items.find((item) => item.tool === "exa__web_search_exa")).toMatchObject({
      role: "tool",
      toolStatus: "done",
      toolInput: { query: "JWT security best practices" },
      toolResult: exaResult,
    });
  });

  test("does not hydrate web_search when providerContent lacks hosted search", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "Plain answer.",
        providerContent: [{ type: "text", text: "Plain answer." }],
      },
    ];

    const items = chatMessagesToListItems(messages);

    expect(items.filter((item) => item.tool === "web_search")).toHaveLength(0);
  });
});
