import { describe, expect, test } from "bun:test";
import type { ChatListItem } from "./chat-history";
import { buildGenerateImageToolState } from "./chat-stream-image-generation";

function toolMessage(
  partial: Partial<ChatListItem> & Pick<ChatListItem, "toolStatus">
): ChatListItem {
  return {
    content: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "tool_1",
    role: "tool",
    tool: "generate_image",
    toolCallId: "call_1",
    toolInput: { prompt: "a red kite" },
    ...partial,
  };
}

describe("chat-stream-image-generation", () => {
  test("buildGenerateImageToolState done exposes artifacts-relative path", () => {
    const state = buildGenerateImageToolState(
      toolMessage({
        toolInput: { prompt: "logo", size: "1024x1024" },
        toolResult: {
          attachmentId: "att_1",
          mimeType: "image/png",
          model: "gpt-image-2",
          path: "artifacts/logo.png",
          sizeBytes: 1200,
        },
        toolStatus: "done",
      })
    );

    expect(state.status).toBe("done");
    expect(state.artifactPath).toBe("logo.png");
    expect(state.error).toBeNull();
  });

  test("buildGenerateImageToolState surfaces tool errors", () => {
    const state = buildGenerateImageToolState(
      toolMessage({
        toolResult: { error: "Configure an image generation model" },
        toolStatus: "done",
      })
    );

    expect(state).toMatchObject({
      artifactPath: null,
      error: "Configure an image generation model",
      status: "error",
    });
  });
});
