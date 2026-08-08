import { describe, expect, test } from "bun:test";
import {
  extractLatestTurnMessages,
  extractPairedTurnArtifacts,
} from "./channel-artifacts";
import type { ChatMessage } from "./contract";

const ARTIFACTS_ROOT =
  "/Users/test/.nakama/orgs/org_1/profiles/profile_1/artifacts";

const metaJson = JSON.stringify({
  mimeType: "text/markdown",
  savedAt: "2026-07-13T10:00:00.000Z",
  sizeBytes: 42,
});

function assistantWithToolCalls(
  toolCalls: ChatMessage extends infer M
    ? M extends { role: "assistant"; toolCalls?: infer T }
      ? NonNullable<T>
      : never
    : never
): ChatMessage {
  return {
    content: "",
    role: "assistant",
    toolCalls,
  };
}

function toolMessage(input: {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
}): ChatMessage {
  return {
    content: JSON.stringify(input.result),
    name: input.name,
    role: "tool",
    toolCallId: input.id,
  };
}

describe("extractPairedTurnArtifacts", () => {
  test("pairs content and sidecar writes into one artifact ref", () => {
    const contentPath = `${ARTIFACTS_ROOT}/report.md`;
    const sidecarPath = `${ARTIFACTS_ROOT}/report.md.nakama-meta.json`;

    const messages: ChatMessage[] = [
      { content: "save report", role: "user" },
      assistantWithToolCalls([
        {
          arguments: { content: "# Report", path: "artifacts/report.md" },
          id: "tool_1",
          name: "write_file",
        },
        {
          arguments: {
            content: metaJson,
            path: "artifacts/report.md.nakama-meta.json",
          },
          id: "tool_2",
          name: "write_file",
        },
      ]),
      toolMessage({
        id: "tool_1",
        input: { content: "# Report", path: "artifacts/report.md" },
        name: "write_file",
        result: { bytesWritten: 8, path: contentPath },
      }),
      toolMessage({
        id: "tool_2",
        input: {
          content: metaJson,
          path: "artifacts/report.md.nakama-meta.json",
        },
        name: "write_file",
        result: { bytesWritten: metaJson.length, path: sidecarPath },
      }),
      { content: "Saved the report.", role: "assistant" },
    ];

    expect(extractPairedTurnArtifacts(messages)).toEqual([
      {
        filename: "report.md",
        mimeType: "text/markdown",
        path: "report.md",
        savedAt: "2026-07-13T10:00:00.000Z",
        sizeBytes: 42,
      },
    ]);
  });

  test("returns empty when content write has no sidecar", () => {
    const contentPath = `${ARTIFACTS_ROOT}/draft.md`;

    expect(
      extractPairedTurnArtifacts([
        { content: "save", role: "user" },
        assistantWithToolCalls([
          {
            arguments: { content: "draft", path: "artifacts/draft.md" },
            id: "tool_1",
            name: "write_file",
          },
        ]),
        toolMessage({
          id: "tool_1",
          input: { content: "draft", path: "artifacts/draft.md" },
          name: "write_file",
          result: { bytesWritten: 5, path: contentPath },
        }),
      ])
    ).toEqual([]);
  });

  test("ignores failed writes", () => {
    expect(
      extractPairedTurnArtifacts([
        { content: "save", role: "user" },
        assistantWithToolCalls([
          {
            arguments: { content: "# Report", path: "artifacts/report.md" },
            id: "tool_1",
            name: "write_file",
          },
        ]),
        toolMessage({
          id: "tool_1",
          input: { content: "# Report", path: "artifacts/report.md" },
          name: "write_file",
          result: { error: "permission denied" },
        }),
      ])
    ).toEqual([]);
  });

  test("ignores writes outside artifacts/", () => {
    expect(
      extractPairedTurnArtifacts([
        { content: "save", role: "user" },
        assistantWithToolCalls([
          {
            arguments: { content: "hello", path: "notes.txt" },
            id: "tool_1",
            name: "write_file",
          },
        ]),
        toolMessage({
          id: "tool_1",
          input: { content: "hello", path: "notes.txt" },
          name: "write_file",
          result: { bytesWritten: 5, path: "/tmp/notes.txt" },
        }),
      ])
    ).toEqual([]);
  });

  test("supports multiple pairs in one turn", () => {
    const messages: ChatMessage[] = [
      { content: "save both", role: "user" },
      assistantWithToolCalls([
        {
          arguments: { content: "a", path: "artifacts/a.md" },
          id: "tool_1",
          name: "write_file",
        },
        {
          arguments: {
            content: metaJson,
            path: "artifacts/a.md.nakama-meta.json",
          },
          id: "tool_2",
          name: "write_file",
        },
        {
          arguments: { content: "b", path: "artifacts/b.md" },
          id: "tool_3",
          name: "write_file",
        },
        {
          arguments: {
            content: metaJson,
            path: "artifacts/b.md.nakama-meta.json",
          },
          id: "tool_4",
          name: "write_file",
        },
      ]),
      toolMessage({
        id: "tool_1",
        input: { content: "a", path: "artifacts/a.md" },
        name: "write_file",
        result: { bytesWritten: 1, path: `${ARTIFACTS_ROOT}/a.md` },
      }),
      toolMessage({
        id: "tool_2",
        input: { content: metaJson, path: "artifacts/a.md.nakama-meta.json" },
        name: "write_file",
        result: {
          bytesWritten: metaJson.length,
          path: `${ARTIFACTS_ROOT}/a.md.nakama-meta.json`,
        },
      }),
      toolMessage({
        id: "tool_3",
        input: { content: "b", path: "artifacts/b.md" },
        name: "write_file",
        result: { bytesWritten: 1, path: `${ARTIFACTS_ROOT}/b.md` },
      }),
      toolMessage({
        id: "tool_4",
        input: { content: metaJson, path: "artifacts/b.md.nakama-meta.json" },
        name: "write_file",
        result: {
          bytesWritten: metaJson.length,
          path: `${ARTIFACTS_ROOT}/b.md.nakama-meta.json`,
        },
      }),
    ];

    expect(
      extractPairedTurnArtifacts(messages).map((artifact) => artifact.path)
    ).toEqual(["a.md", "b.md"]);
  });

  test("extracts successful generate_image tool results without write_file pairs", () => {
    expect(
      extractPairedTurnArtifacts([
        { content: "draw a cat", role: "user" },
        assistantWithToolCalls([
          {
            arguments: { prompt: "a cat" },
            id: "tool_img",
            name: "generate_image",
          },
        ]),
        toolMessage({
          id: "tool_img",
          input: { prompt: "a cat" },
          name: "generate_image",
          result: {
            attachmentId: "att_1",
            mimeType: "image/png",
            model: "gpt-image-2",
            path: "artifacts/cat.png",
            sizeBytes: 2048,
          },
        }),
        { content: "Here is your cat.", role: "assistant" },
      ])
    ).toEqual([
      {
        filename: "cat.png",
        mimeType: "image/png",
        path: "cat.png",
        savedAt: "",
        sizeBytes: 2048,
      },
    ]);
  });

  test("ignores failed generate_image tool results", () => {
    expect(
      extractPairedTurnArtifacts([
        { content: "draw", role: "user" },
        assistantWithToolCalls([
          {
            arguments: { prompt: "a cat" },
            id: "tool_img",
            name: "generate_image",
          },
        ]),
        toolMessage({
          id: "tool_img",
          input: { prompt: "a cat" },
          name: "generate_image",
          result: { error: "Image model is not configured." },
        }),
      ])
    ).toEqual([]);
  });

  test("rejects generate_image results missing mimeType", () => {
    expect(
      extractPairedTurnArtifacts([
        { content: "draw", role: "user" },
        assistantWithToolCalls([
          {
            arguments: { prompt: "a cat" },
            id: "tool_img",
            name: "generate_image",
          },
        ]),
        toolMessage({
          id: "tool_img",
          input: { prompt: "a cat" },
          name: "generate_image",
          result: {
            path: "artifacts/cat.png",
            sizeBytes: 2048,
          },
        }),
      ])
    ).toEqual([]);
  });

  test("rejects generate_image paths outside artifacts/", () => {
    expect(
      extractPairedTurnArtifacts([
        { content: "draw", role: "user" },
        assistantWithToolCalls([
          {
            arguments: { prompt: "a cat" },
            id: "tool_img",
            name: "generate_image",
          },
        ]),
        toolMessage({
          id: "tool_img",
          input: { prompt: "a cat" },
          name: "generate_image",
          result: {
            mimeType: "image/png",
            path: "tmp/cat.png",
            sizeBytes: 2048,
          },
        }),
      ])
    ).toEqual([]);
  });

  test("keeps oversized generate_image refs with their sizeBytes for channel policy", () => {
    const oversized = 6 * 1024 * 1024;
    expect(
      extractPairedTurnArtifacts([
        { content: "draw", role: "user" },
        assistantWithToolCalls([
          {
            arguments: { prompt: "huge" },
            id: "tool_img",
            name: "generate_image",
          },
        ]),
        toolMessage({
          id: "tool_img",
          input: { prompt: "huge" },
          name: "generate_image",
          result: {
            mimeType: "image/png",
            path: "artifacts/huge.png",
            sizeBytes: oversized,
          },
        }),
      ])
    ).toEqual([
      {
        filename: "huge.png",
        mimeType: "image/png",
        path: "huge.png",
        savedAt: "",
        sizeBytes: oversized,
      },
    ]);
  });

  test("extracts write_file pairs and generate_image together in one turn", () => {
    const messages: ChatMessage[] = [
      { content: "save and draw", role: "user" },
      assistantWithToolCalls([
        {
          arguments: { content: "a", path: "artifacts/a.md" },
          id: "tool_1",
          name: "write_file",
        },
        {
          arguments: {
            content: metaJson,
            path: "artifacts/a.md.nakama-meta.json",
          },
          id: "tool_2",
          name: "write_file",
        },
        {
          arguments: { prompt: "a cat" },
          id: "tool_img",
          name: "generate_image",
        },
      ]),
      toolMessage({
        id: "tool_1",
        input: { content: "a", path: "artifacts/a.md" },
        name: "write_file",
        result: { bytesWritten: 1, path: `${ARTIFACTS_ROOT}/a.md` },
      }),
      toolMessage({
        id: "tool_2",
        input: { content: metaJson, path: "artifacts/a.md.nakama-meta.json" },
        name: "write_file",
        result: {
          bytesWritten: metaJson.length,
          path: `${ARTIFACTS_ROOT}/a.md.nakama-meta.json`,
        },
      }),
      toolMessage({
        id: "tool_img",
        input: { prompt: "a cat" },
        name: "generate_image",
        result: {
          attachmentId: "att_1",
          mimeType: "image/png",
          model: "gpt-image-2",
          path: "artifacts/cat.png",
          sizeBytes: 2048,
        },
      }),
    ];

    expect(
      extractPairedTurnArtifacts(messages).map((artifact) => artifact.path)
    ).toEqual(["a.md", "cat.png"]);
  });
});

describe("extractLatestTurnMessages", () => {
  test("slices from the last user message", () => {
    const messages: ChatMessage[] = [
      { content: "first", role: "user" },
      { content: "one", role: "assistant" },
      { content: "second", role: "user" },
      { content: "two", role: "assistant" },
    ];

    expect(extractLatestTurnMessages(messages)).toEqual([
      { content: "second", role: "user" },
      { content: "two", role: "assistant" },
    ]);
  });
});
