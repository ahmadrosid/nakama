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
      toolCallId: "call_1",
      tool: "write_file",
      accumulatedArguments: '{"path":"artifacts/a.md","content":"# Hi"}',
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      toolCallId: "call_1",
      artifactStreaming: true,
      toolStatus: "running",
      toolInput: { path: "artifacts/a.md", content: "# Hi" },
    });
  });

  test("updates an existing streaming tool row", () => {
    const initial: ChatListItem[] = [
      {
        id: "call_1",
        role: "tool",
        content: "write_file",
        toolCallId: "call_1",
        tool: "write_file",
        toolStatus: "running",
        artifactStreaming: true,
        toolInputAccumulatedJson: '{"path":"artifacts/a.md","content":"#"}',
      },
    ];

    const next = upsertStreamingToolMessage(initial, {
      toolCallId: "call_1",
      tool: "write_file",
      accumulatedArguments: '{"path":"artifacts/a.md","content":"# Hi"}',
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.toolInput).toEqual({ path: "artifacts/a.md", content: "# Hi" });
  });

  test("ignores non-artifact tools", () => {
    expect(
      upsertStreamingToolMessage([], {
        toolCallId: "call_1",
        tool: "bash",
        accumulatedArguments: '{"command":"ls"}',
      }),
    ).toEqual([]);
  });

  test("ignores meta sidecar writes", () => {
    expect(
      upsertStreamingToolMessage([], {
        toolCallId: "call_meta",
        tool: "write_file",
        accumulatedArguments:
          '{"path":"artifacts/report.md.nakama-meta.json","content":"{}"}',
      }),
    ).toEqual([]);
  });
});

describe("findLatestStreamingArtifact", () => {
  test("returns the latest eligible streaming artifact", () => {
    const messages: ChatListItem[] = [
      {
        id: "call_1",
        role: "tool",
        content: "write_file",
        toolCallId: "call_1",
        tool: "write_file",
        toolStatus: "running",
        artifactStreaming: true,
        toolInputAccumulatedJson: '{"path":"artifacts/a.md","content":"hello"}',
      },
    ];

    expect(findLatestStreamingArtifact(messages)?.parsed).toEqual({
      eligible: true,
      relativePath: "a.md",
      filename: "a.md",
      content: "hello",
    });
  });
});

describe("findCompletedContentArtifact", () => {
  const ARTIFACTS_ROOT = "/Users/test/.nakama/orgs/org_1/profiles/profile_1/artifacts";

  test("returns completed content artifact path", () => {
    const messages: ChatListItem[] = [
      {
        id: "call_1",
        role: "tool",
        content: "write_file completed",
        toolCallId: "call_1",
        tool: "write_file",
        toolStatus: "done",
        toolResult: {
          path: `${ARTIFACTS_ROOT}/report.md`,
          bytesWritten: 12,
        },
      },
    ];

    expect(findCompletedContentArtifact(messages, "call_1")).toEqual({
      toolCallId: "call_1",
      tool: "write_file",
      relativePath: "report.md",
    });
  });

  test("ignores completed meta sidecar writes", () => {
    const messages: ChatListItem[] = [
      {
        id: "call_meta",
        role: "tool",
        content: "write_file completed",
        toolCallId: "call_meta",
        tool: "write_file",
        toolStatus: "done",
        toolResult: {
          path: `${ARTIFACTS_ROOT}/report.md.nakama-meta.json`,
          bytesWritten: 12,
        },
      },
    ];

    expect(findCompletedContentArtifact(messages, "call_meta")).toBeNull();
  });
});
