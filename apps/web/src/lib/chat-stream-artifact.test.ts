import { describe, expect, test } from "bun:test";
import type { ChatListItem } from "@/lib/chat-history";
import {
  findCompletedContentArtifact,
  findLatestStreamingArtifact,
  upsertStreamingToolMessage,
} from "./chat-stream-artifact";

describe("upsertStreamingToolMessage", () => {
  test("creates a streaming tool row for artifact write_file deltas", () => {
    const next = upsertStreamingToolMessage([], {
      accumulatedArguments: '{"path":"artifacts/a.md","content":"# Hi"}',
      tool: "write_file",
      toolCallId: "call_1",
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      artifactStreaming: true,
      toolCallId: "call_1",
      toolInput: { content: "# Hi", path: "artifacts/a.md" },
      toolStatus: "running",
    });
  });

  test("updates an existing streaming tool row", () => {
    const initial: ChatListItem[] = [
      {
        artifactStreaming: true,
        content: "write_file",
        id: "call_1",
        role: "tool",
        tool: "write_file",
        toolCallId: "call_1",
        toolInputAccumulatedJson: '{"path":"artifacts/a.md","content":"#"}',
        toolStatus: "running",
      },
    ];

    const next = upsertStreamingToolMessage(initial, {
      accumulatedArguments: '{"path":"artifacts/a.md","content":"# Hi"}',
      tool: "write_file",
      toolCallId: "call_1",
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.toolInput).toEqual({
      content: "# Hi",
      path: "artifacts/a.md",
    });
  });

  test("ignores non-artifact tools", () => {
    expect(
      upsertStreamingToolMessage([], {
        accumulatedArguments: '{"command":"ls"}',
        tool: "bash",
        toolCallId: "call_1",
      })
    ).toEqual([]);
  });

  test("ignores meta sidecar writes", () => {
    expect(
      upsertStreamingToolMessage([], {
        accumulatedArguments:
          '{"path":"artifacts/report.md.nakama-meta.json","content":"{}"}',
        tool: "write_file",
        toolCallId: "call_meta",
      })
    ).toEqual([]);
  });
});

describe("findLatestStreamingArtifact", () => {
  test("returns the latest eligible streaming artifact", () => {
    const messages: ChatListItem[] = [
      {
        artifactStreaming: true,
        content: "write_file",
        id: "call_1",
        role: "tool",
        tool: "write_file",
        toolCallId: "call_1",
        toolInputAccumulatedJson: '{"path":"artifacts/a.md","content":"hello"}',
        toolStatus: "running",
      },
    ];

    expect(findLatestStreamingArtifact(messages)?.parsed).toEqual({
      content: "hello",
      eligible: true,
      filename: "a.md",
      relativePath: "a.md",
    });
  });
});

describe("findCompletedContentArtifact", () => {
  const ARTIFACTS_ROOT =
    "/Users/test/.nakama/orgs/org_1/profiles/profile_1/artifacts";

  test("returns completed content artifact path", () => {
    const messages: ChatListItem[] = [
      {
        content: "write_file completed",
        id: "call_1",
        role: "tool",
        tool: "write_file",
        toolCallId: "call_1",
        toolResult: {
          bytesWritten: 12,
          path: `${ARTIFACTS_ROOT}/report.md`,
        },
        toolStatus: "done",
      },
    ];

    expect(findCompletedContentArtifact(messages, "call_1")).toEqual({
      relativePath: "report.md",
      tool: "write_file",
      toolCallId: "call_1",
    });
  });

  test("ignores completed meta sidecar writes", () => {
    const messages: ChatListItem[] = [
      {
        content: "write_file completed",
        id: "call_meta",
        role: "tool",
        tool: "write_file",
        toolCallId: "call_meta",
        toolResult: {
          bytesWritten: 12,
          path: `${ARTIFACTS_ROOT}/report.md.nakama-meta.json`,
        },
        toolStatus: "done",
      },
    ];

    expect(findCompletedContentArtifact(messages, "call_meta")).toBeNull();
  });
});
