import { describe, expect, test } from "bun:test";
import type { ChatMessage, SessionMessageMeta } from "@nakama/core/contract";
import { AGENT_CHANNELS } from "@nakama/core/contract";
import { extractTurnArtifacts } from "./chat-artifacts";
import {
  chatMessagesToListItems,
  formatSessionRelativeTime,
  formatSessionTimestamp,
  HISTORY_SESSION_CHANNELS,
  isReadOnlySessionChannel,
} from "./chat-history";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("chatMessagesToListItems", () => {
  test("preserves history index and metadata for rendered items", () => {
    const messages: ChatMessage[] = [
      { content: "Hello", role: "user" },
      {
        content: "",
        role: "assistant",
        toolCalls: [
          { arguments: { path: "src" }, id: "tool_1", name: "search_files" },
        ],
      },
      {
        content: '{"ok":true}',
        name: "search_files",
        role: "tool",
        toolCallId: "tool_1",
      },
      { content: "Done", role: "assistant" },
    ];
    const messageMeta: SessionMessageMeta[] = [
      { createdAt: "2026-06-14T10:00:00.000Z", id: "msg_1", seq: 0 },
      { createdAt: "2026-06-14T10:00:01.000Z", id: "msg_2", seq: 1 },
      { createdAt: "2026-06-14T10:00:02.000Z", id: "msg_3", seq: 2 },
      { createdAt: "2026-06-14T10:00:03.000Z", id: "msg_4", seq: 3 },
    ];

    const items = chatMessagesToListItems(messages, messageMeta);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      createdAt: "2026-06-14T10:00:00.000Z",
      historyIndex: 0,
      role: "user",
    });
    expect(items[1]).toMatchObject({
      createdAt: "2026-06-14T10:00:02.000Z",
      historyIndex: 2,
      role: "tool",
      toolInput: { path: "src" },
    });
    expect(items[2]).toMatchObject({
      content: "Done",
      createdAt: "2026-06-14T10:00:03.000Z",
      historyIndex: 3,
      role: "assistant",
    });
  });

  test("renders described images as attachments and keeps vision-native images inline", () => {
    const messages: ChatMessage[] = [
      {
        content: [
          { text: "What is this?", type: "text" },
          {
            data: tinyPngBase64,
            description: "A red square.",
            mediaType: "image/png",
            type: "image",
          },
        ],
        role: "user",
      },
      {
        content: [
          { text: "Another one", type: "text" },
          { data: tinyPngBase64, mediaType: "image/png", type: "image" },
        ],
        role: "user",
      },
      {
        content: "[Image]\nLegacy description only.",
        role: "user",
      },
    ];

    const items = chatMessagesToListItems(messages);

    expect(items[0]).toMatchObject({
      content: "What is this?",
      imageAttachments: [
        {
          description: "A red square.",
          mediaType: "image/png",
          url: `data:image/png;base64,${tinyPngBase64}`,
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
      imageAttachments: [
        { description: "Legacy description only.", mediaType: "image/unknown" },
      ],
    });
  });

  test("derives artifact refs from persisted write_file tool messages after hydration", () => {
    const artifactsRoot =
      "/Users/test/.nakama/orgs/org_1/profiles/profile_1/artifacts";
    const metaJson = JSON.stringify({
      mimeType: "text/markdown",
      savedAt: "2026-07-13T10:00:00.000Z",
      sizeBytes: 12,
    });
    const messages: ChatMessage[] = [
      {
        content: "",
        role: "assistant",
        toolCalls: [
          {
            arguments: { content: "# Report", path: "artifacts/report.md" },
            id: "tool_content",
            name: "write_file",
          },
          {
            arguments: {
              content: metaJson,
              path: "artifacts/report.md.nakama-meta.json",
            },
            id: "tool_meta",
            name: "write_file",
          },
        ],
      },
      {
        content: JSON.stringify({
          bytesWritten: 8,
          path: `${artifactsRoot}/report.md`,
        }),
        name: "write_file",
        role: "tool",
        toolCallId: "tool_content",
      },
      {
        content: JSON.stringify({
          bytesWritten: metaJson.length,
          path: `${artifactsRoot}/report.md.nakama-meta.json`,
        }),
        name: "write_file",
        role: "tool",
        toolCallId: "tool_meta",
      },
      { content: "Saved the report for you.", role: "assistant" },
    ];

    const items = chatMessagesToListItems(messages);
    const assistantTurnItems = items.filter((item) => item.role !== "user");
    const artifacts = extractTurnArtifacts(assistantTurnItems);

    expect(artifacts).toEqual([
      {
        filename: "report.md",
        mimeType: "text/markdown",
        path: "report.md",
        savedAt: "2026-07-13T10:00:00.000Z",
        sizeBytes: 12,
      },
    ]);
  });

  test("hydrates web_search tool rows from assistant providerContent", () => {
    const messages: ChatMessage[] = [
      { content: "Search the web for JWT security", role: "user" },
      {
        content: "Here is what I found about JWT security.",
        providerContent: [
          {
            id: "srvtool_abc",
            input: { query: "JWT security best practices" },
            name: "web_search",
            type: "server_tool_use",
          },
          {
            content: [
              {
                title: "JWT Security Best Practices",
                type: "web_search_result",
                url: "https://auth0.com/blog/jwt-security-best-practices",
              },
            ],
            tool_use_id: "srvtool_abc",
            type: "web_search_tool_result",
          },
        ],
        role: "assistant",
      },
    ];

    const items = chatMessagesToListItems(messages);

    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({
      role: "tool",
      tool: "web_search",
      toolCallId: "srvtool_abc",
      toolInput: { query: "JWT security best practices" },
      toolStatus: "done",
    });
    expect(items[2]).toMatchObject({
      content: "Here is what I found about JWT security.",
      role: "assistant",
    });
  });

  test("does not duplicate web_search when a persisted tool row exists", () => {
    const messages: ChatMessage[] = [
      {
        content: "Searching…",
        providerContent: [
          {
            id: "srvtool_abc",
            input: { query: "JWT" },
            name: "web_search",
            type: "server_tool_use",
          },
          {
            content: [
              {
                title: "JWT",
                type: "web_search_result",
                url: "https://example.com/jwt",
              },
            ],
            tool_use_id: "srvtool_abc",
            type: "web_search_tool_result",
          },
        ],
        role: "assistant",
      },
      {
        content: JSON.stringify([
          {
            title: "JWT",
            type: "web_search_result",
            url: "https://example.com/jwt",
          },
        ]),
        name: "web_search",
        role: "tool",
        toolCallId: "srvtool_abc",
      },
      { content: "Done.", role: "assistant" },
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
        content: "",
        providerContent: [
          {
            id: "srvtool_abc",
            input: { query: "JWT" },
            name: "web_search",
            type: "server_tool_use",
          },
          {
            content: [
              {
                title: "JWT",
                type: "web_search_result",
                url: "https://example.com/jwt",
              },
            ],
            tool_use_id: "srvtool_abc",
            type: "web_search_tool_result",
          },
        ],
        role: "assistant",
        toolCalls: [
          {
            arguments: { query: "JWT" },
            id: "srvtool_abc",
            name: "web_search",
          },
        ],
      },
      {
        content: JSON.stringify([
          {
            title: "JWT",
            type: "web_search_result",
            url: "https://example.com/jwt",
          },
        ]),
        name: "web_search",
        role: "tool",
        toolCallId: "srvtool_abc",
      },
      { content: "Done.", role: "assistant" },
    ];

    const items = chatMessagesToListItems(messages);
    const webSearchItems = items.filter((item) => item.tool === "web_search");

    expect(webSearchItems).toHaveLength(1);
    expect(webSearchItems[0]?.toolCallId).toBe("srvtool_abc");
  });

  test("preserves web_fetch tool rows from persisted tool messages", () => {
    const fetchResult = {
      bytes: 42,
      content: "# Docs",
      contentType: "text/markdown",
      finalUrl: "https://example.com/docs",
      status: 200,
      url: "https://example.com/start",
    };
    const messages: ChatMessage[] = [
      { content: "Fetch the docs page", role: "user" },
      {
        content: "",
        role: "assistant",
        toolCalls: [
          {
            arguments: { url: "https://example.com/docs" },
            id: "tool_fetch_1",
            name: "web_fetch",
          },
        ],
      },
      {
        content: JSON.stringify(fetchResult),
        name: "web_fetch",
        role: "tool",
        toolCallId: "tool_fetch_1",
      },
      { content: "Here is the page.", role: "assistant" },
    ];

    const items = chatMessagesToListItems(messages);

    expect(items.find((item) => item.tool === "web_fetch")).toMatchObject({
      role: "tool",
      toolInput: { url: "https://example.com/docs" },
      toolResult: fetchResult,
      toolStatus: "done",
    });
  });

  test("preserves Exa MCP web search tool rows from persisted tool messages", () => {
    const exaResult = {
      text: "Title: JWT Guide\nURL: https://example.com/jwt\nPublished: N/A\nAuthor: N/A",
    };
    const messages: ChatMessage[] = [
      { content: "Search for JWT security", role: "user" },
      {
        content: "",
        role: "assistant",
        toolCalls: [
          {
            arguments: { query: "JWT security best practices" },
            id: "tool_exa_1",
            name: "exa__web_search_exa",
          },
        ],
      },
      {
        content: JSON.stringify(exaResult),
        name: "exa__web_search_exa",
        role: "tool",
        toolCallId: "tool_exa_1",
      },
      { content: "Here is what I found.", role: "assistant" },
    ];

    const items = chatMessagesToListItems(messages);

    expect(
      items.find((item) => item.tool === "exa__web_search_exa")
    ).toMatchObject({
      role: "tool",
      toolInput: { query: "JWT security best practices" },
      toolResult: exaResult,
      toolStatus: "done",
    });
  });

  test("does not hydrate web_search when providerContent lacks hosted search", () => {
    const messages: ChatMessage[] = [
      {
        content: "Plain answer.",
        providerContent: [{ text: "Plain answer.", type: "text" }],
        role: "assistant",
      },
    ];

    const items = chatMessagesToListItems(messages);

    expect(items.filter((item) => item.tool === "web_search")).toHaveLength(0);
  });
});

describe("formatSessionTimestamp", () => {
  test("formats a valid ISO timestamp", () => {
    const formatted = formatSessionTimestamp("2026-06-14T10:00:00.000Z");
    expect(formatted).not.toBe("Unknown time");
    expect(formatted.length).toBeGreaterThan(0);
  });

  test("does not echo invalid or attacker-controlled date strings", () => {
    expect(formatSessionTimestamp("not-a-date")).toBe("Unknown time");
    expect(formatSessionTimestamp("<img src=x onerror=alert(1)>")).toBe(
      "Unknown time"
    );
    expect(formatSessionRelativeTime("totally-bogus")).toBe("Unknown time");
  });
});

// Both web channel tables, every channel named. Flipping one value in either
// table fails one of these, which is what the tables are for: a channel that
// joins AGENT_CHANNELS has to be decided rather than dropping out in silence.
describe("session channel tables", () => {
  test("lists the four channels that have a web history", () => {
    expect(HISTORY_SESSION_CHANNELS).toEqual([
      "web",
      "telegram",
      "whatsapp",
      "discord",
    ]);
  });

  test("marks the three messaging channels read only and no others", () => {
    const readOnly = AGENT_CHANNELS.filter((channel) =>
      isReadOnlySessionChannel(channel)
    );

    expect(readOnly).toEqual(["telegram", "whatsapp", "discord"]);
  });

  test("every listed channel except web is read only", () => {
    const writable = HISTORY_SESSION_CHANNELS.filter(
      (channel) => !isReadOnlySessionChannel(channel)
    );

    expect(writable).toEqual(["web"]);
  });
});
