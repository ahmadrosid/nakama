import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "./contract";
import { extractLatestTurnMessages, extractPairedTurnArtifacts } from "./channel-artifacts";

const ARTIFACTS_ROOT = "/Users/test/.nakama/orgs/org_1/profiles/profile_1/artifacts";

const metaJson = JSON.stringify({
  mimeType: "text/markdown",
  savedAt: "2026-07-13T10:00:00.000Z",
  sizeBytes: 42,
});

function assistantWithToolCalls(toolCalls: ChatMessage extends infer M
  ? M extends { role: "assistant"; toolCalls?: infer T }
    ? NonNullable<T>
    : never
  : never): ChatMessage {
  return {
    role: "assistant",
    content: "",
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
    role: "tool",
    toolCallId: input.id,
    name: input.name,
    content: JSON.stringify(input.result),
  };
}

describe("extractPairedTurnArtifacts", () => {
  test("pairs content and sidecar writes into one artifact ref", () => {
    const contentPath = `${ARTIFACTS_ROOT}/report.md`;
    const sidecarPath = `${ARTIFACTS_ROOT}/report.md.nakama-meta.json`;

    const messages: ChatMessage[] = [
      { role: "user", content: "save report" },
      assistantWithToolCalls([
        {
          id: "tool_1",
          name: "write_file",
          arguments: { path: "artifacts/report.md", content: "# Report" },
        },
        {
          id: "tool_2",
          name: "write_file",
          arguments: { path: "artifacts/report.md.nakama-meta.json", content: metaJson },
        },
      ]),
      toolMessage({
        id: "tool_1",
        name: "write_file",
        input: { path: "artifacts/report.md", content: "# Report" },
        result: { path: contentPath, bytesWritten: 8 },
      }),
      toolMessage({
        id: "tool_2",
        name: "write_file",
        input: { path: "artifacts/report.md.nakama-meta.json", content: metaJson },
        result: { path: sidecarPath, bytesWritten: metaJson.length },
      }),
      { role: "assistant", content: "Saved the report." },
    ];

    expect(extractPairedTurnArtifacts(messages)).toEqual([
      {
        filename: "report.md",
        path: "report.md",
        mimeType: "text/markdown",
        sizeBytes: 42,
        savedAt: "2026-07-13T10:00:00.000Z",
      },
    ]);
  });

  test("returns empty when content write has no sidecar", () => {
    const contentPath = `${ARTIFACTS_ROOT}/draft.md`;

    expect(
      extractPairedTurnArtifacts([
        { role: "user", content: "save" },
        assistantWithToolCalls([
          {
            id: "tool_1",
            name: "write_file",
            arguments: { path: "artifacts/draft.md", content: "draft" },
          },
        ]),
        toolMessage({
          id: "tool_1",
          name: "write_file",
          input: { path: "artifacts/draft.md", content: "draft" },
          result: { path: contentPath, bytesWritten: 5 },
        }),
      ]),
    ).toEqual([]);
  });

  test("ignores failed writes", () => {
    expect(
      extractPairedTurnArtifacts([
        { role: "user", content: "save" },
        assistantWithToolCalls([
          {
            id: "tool_1",
            name: "write_file",
            arguments: { path: "artifacts/report.md", content: "# Report" },
          },
        ]),
        toolMessage({
          id: "tool_1",
          name: "write_file",
          input: { path: "artifacts/report.md", content: "# Report" },
          result: { error: "permission denied" },
        }),
      ]),
    ).toEqual([]);
  });

  test("ignores writes outside artifacts/", () => {
    expect(
      extractPairedTurnArtifacts([
        { role: "user", content: "save" },
        assistantWithToolCalls([
          {
            id: "tool_1",
            name: "write_file",
            arguments: { path: "notes.txt", content: "hello" },
          },
        ]),
        toolMessage({
          id: "tool_1",
          name: "write_file",
          input: { path: "notes.txt", content: "hello" },
          result: { path: "/tmp/notes.txt", bytesWritten: 5 },
        }),
      ]),
    ).toEqual([]);
  });

  test("supports multiple pairs in one turn", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "save both" },
      assistantWithToolCalls([
        {
          id: "tool_1",
          name: "write_file",
          arguments: { path: "artifacts/a.md", content: "a" },
        },
        {
          id: "tool_2",
          name: "write_file",
          arguments: { path: "artifacts/a.md.nakama-meta.json", content: metaJson },
        },
        {
          id: "tool_3",
          name: "write_file",
          arguments: { path: "artifacts/b.md", content: "b" },
        },
        {
          id: "tool_4",
          name: "write_file",
          arguments: { path: "artifacts/b.md.nakama-meta.json", content: metaJson },
        },
      ]),
      toolMessage({
        id: "tool_1",
        name: "write_file",
        input: { path: "artifacts/a.md", content: "a" },
        result: { path: `${ARTIFACTS_ROOT}/a.md`, bytesWritten: 1 },
      }),
      toolMessage({
        id: "tool_2",
        name: "write_file",
        input: { path: "artifacts/a.md.nakama-meta.json", content: metaJson },
        result: { path: `${ARTIFACTS_ROOT}/a.md.nakama-meta.json`, bytesWritten: metaJson.length },
      }),
      toolMessage({
        id: "tool_3",
        name: "write_file",
        input: { path: "artifacts/b.md", content: "b" },
        result: { path: `${ARTIFACTS_ROOT}/b.md`, bytesWritten: 1 },
      }),
      toolMessage({
        id: "tool_4",
        name: "write_file",
        input: { path: "artifacts/b.md.nakama-meta.json", content: metaJson },
        result: { path: `${ARTIFACTS_ROOT}/b.md.nakama-meta.json`, bytesWritten: metaJson.length },
      }),
    ];

    expect(extractPairedTurnArtifacts(messages).map((artifact) => artifact.path)).toEqual([
      "a.md",
      "b.md",
    ]);
  });
});

describe("extractLatestTurnMessages", () => {
  test("slices from the last user message", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "one" },
      { role: "user", content: "second" },
      { role: "assistant", content: "two" },
    ];

    expect(extractLatestTurnMessages(messages)).toEqual([
      { role: "user", content: "second" },
      { role: "assistant", content: "two" },
    ]);
  });
});
