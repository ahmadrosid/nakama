import { describe, expect, test } from "bun:test";
import type { ChatListItem } from "./chat-history";
import {
  buildGenerateImageToolState,
  formatImageGenerationResolution,
  imageGenerationAspectFromSize,
  parseGenerateImagePrompt,
  parseGenerateImageSize,
  shouldRenderGenerateImageToolRow,
} from "./chat-stream-image-generation";

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
  test("parseGenerateImagePrompt and size", () => {
    expect(parseGenerateImagePrompt({ prompt: "  lake  " })).toBe("lake");
    expect(parseGenerateImagePrompt({})).toBeNull();
    expect(parseGenerateImageSize({ size: "1024x1536" })).toBe("1024x1536");
    expect(parseGenerateImageSize({ prompt: "x" })).toBeNull();
  });

  test("formatImageGenerationResolution uses multiplication sign", () => {
    expect(formatImageGenerationResolution("1024x1024")).toBe("1024 × 1024");
    expect(formatImageGenerationResolution("1536x1024")).toBe("1536 × 1024");
    expect(formatImageGenerationResolution("auto")).toBe("auto");
    expect(formatImageGenerationResolution(null)).toBe("1024 × 1024");
  });

  test("imageGenerationAspectFromSize maps ratios", () => {
    expect(imageGenerationAspectFromSize("1024x1024")).toBe("square");
    expect(imageGenerationAspectFromSize("1024x1536")).toBe("portrait");
    expect(imageGenerationAspectFromSize("1536x1024")).toBe("landscape");
    expect(imageGenerationAspectFromSize("auto")).toBe("square");
  });

  test("buildGenerateImageToolState running uses prompt and resolution", () => {
    const state = buildGenerateImageToolState(
      toolMessage({
        toolInput: {
          prompt: "a calm mountain lake at dawn",
          size: "1024x1536",
        },
        toolStatus: "running",
      })
    );

    expect(state).toEqual({
      artifactPath: null,
      aspect: "portrait",
      error: null,
      prompt: "a calm mountain lake at dawn",
      resolution: "1024 × 1536",
      status: "running",
    });
  });

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

  test("shouldRenderGenerateImageToolRow is true for generate_image", () => {
    expect(
      shouldRenderGenerateImageToolRow(toolMessage({ toolStatus: "running" }))
    ).toBe(true);
    expect(
      shouldRenderGenerateImageToolRow({
        ...toolMessage({ toolStatus: "done" }),
        tool: "web_search",
      })
    ).toBe(false);
  });
});
