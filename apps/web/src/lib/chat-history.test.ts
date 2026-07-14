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
});
