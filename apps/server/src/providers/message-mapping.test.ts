import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@nakama/core";
import { toAnthropicMessages } from "./anthropic";
import { toGeminiContents } from "./gemini";
import { toOpenAIMessages, toResponsesInput } from "./openai";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const multimodalUserMessage: ChatMessage = {
  role: "user",
  content: [
    { type: "text", text: "What is this?" },
    { type: "image", mediaType: "image/png", data: tinyPngBase64 },
  ],
};

const documentUserMessage: ChatMessage = {
  role: "user",
  content: [
    { type: "text", text: "Summarize this file" },
    {
      type: "document",
      filename: "report.pdf",
      mediaType: "application/pdf",
      data: "JVBERi0=",
    },
  ],
};

describe("provider user content mapping", () => {
  test("toAnthropicMessages maps image parts", async () => {
    const result = await toAnthropicMessages([multimodalUserMessage]);
    const user = result[0];

    expect(user?.role).toBe("user");
    expect(Array.isArray(user?.content)).toBe(true);

    const blocks = user?.content as Array<Record<string, unknown>>;
    expect(blocks[0]).toEqual({ type: "text", text: "What is this?" });
    expect(blocks[1]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: tinyPngBase64,
      },
    });
  });

  test("toAnthropicMessages maps document parts", async () => {
    const result = await toAnthropicMessages([documentUserMessage]);
    const user = result[0];
    const blocks = user?.content as Array<Record<string, unknown>>;

    expect(blocks[1]).toEqual({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: "JVBERi0=",
      },
    });
  });

  test("toAnthropicMessages inlines text/plain documents for opencode_go", async () => {
    const text = "alpha beta gamma";
    const data = Buffer.from(text, "utf8").toString("base64");
    const message: ChatMessage = {
      role: "user",
      content: [
        { type: "text", text: "Summarize" },
        {
          type: "document",
          filename: "Pasted text (3 words).txt",
          mediaType: "text/plain",
          data,
        },
      ],
    };

    const result = await toAnthropicMessages([message], "opencode_go");
    const user = result[0];
    const blocks = user?.content as Array<Record<string, unknown>>;

    expect(blocks[0]).toEqual({ type: "text", text: "Summarize" });
    expect(blocks[1]).toEqual({
      type: "text",
      text: "[File: Pasted text (3 words).txt]\nalpha beta gamma",
    });
  });

  test("toGeminiContents maps image and document parts", async () => {
    const imageResult = await toGeminiContents([multimodalUserMessage]);
    expect(imageResult[0]?.parts?.[0]?.text).toBe("What is this?");
    expect(imageResult[0]?.parts?.[1]?.inlineData).toEqual({
      mimeType: "image/png",
      data: tinyPngBase64,
    });

    const docResult = await toGeminiContents([documentUserMessage]);
    expect(docResult[0]?.parts?.[1]?.inlineData).toEqual({
      mimeType: "application/pdf",
      data: "JVBERi0=",
    });
  });

  test("toOpenAIMessages maps image parts", async () => {
    const result = await toOpenAIMessages("system", [multimodalUserMessage]);
    const user = result.find((message) => message.role === "user");

    expect(Array.isArray(user?.content)).toBe(true);

    const parts = user?.content as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({ type: "text", text: "What is this?" });
    expect(parts[1]?.type).toBe("image_url");
    expect((parts[1]?.image_url as { url: string }).url).toStartWith(
      "data:image/png;base64,",
    );
  });

  test("toResponsesInput maps image parts", async () => {
    const result = await toResponsesInput([multimodalUserMessage]);
    const user = result[0] as {
      type?: string;
      role: string;
      content: Array<Record<string, unknown>>;
    };

    expect(user.type).toBe("message");
    expect(user.role).toBe("user");
    expect(user.content[0]).toEqual({ type: "input_text", text: "What is this?" });
    expect(user.content[1]?.type).toBe("input_image");
    expect(user.content[1]?.image_url).toStartWith("data:image/png;base64,");
  });

  test("toOpenAIMessages maps document parts", async () => {
    const result = await toOpenAIMessages("system", [documentUserMessage]);
    const user = result.find((message) => message.role === "user");
    const parts = user?.content as Array<Record<string, unknown>>;

    expect(parts[1]).toEqual({
      type: "input_file",
      filename: "report.pdf",
      file_data: "data:application/pdf;base64,JVBERi0=",
    });
  });

  test("toOpenAIMessages inlines text/plain documents for opencode_go", async () => {
    const text = "alpha beta gamma";
    const data = Buffer.from(text, "utf8").toString("base64");
    const message: ChatMessage = {
      role: "user",
      content: [
        { type: "text", text: "Summarize" },
        {
          type: "document",
          filename: "Pasted text (3 words).txt",
          mediaType: "text/plain",
          data,
        },
      ],
    };

    const result = await toOpenAIMessages("system", [message], "opencode_go");
    const user = result.find((entry) => entry.role === "user");
    const parts = user?.content as Array<Record<string, unknown>>;

    expect(parts[0]).toEqual({ type: "text", text: "Summarize" });
    expect(parts[1]).toEqual({
      type: "text",
      text: "[File: Pasted text (3 words).txt]\nalpha beta gamma",
    });
  });

  test("toResponsesInput maps document parts", async () => {
    const result = await toResponsesInput([documentUserMessage]);
    const user = result[0] as {
      type?: string;
      role: string;
      content: Array<Record<string, unknown>>;
    };

    expect(user.content[1]).toEqual({
      type: "input_file",
      filename: "report.pdf",
      file_data: "data:application/pdf;base64,JVBERi0=",
    });
  });

  test("toResponsesInput aligns function_call ids with tool outputs", async () => {
    const result = (await toResponsesInput([
      { role: "user", content: "run my digest" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_tool_id",
            name: "run_automation",
            arguments: { automationId: "automation_1" },
          },
        ],
        providerContent: [
          {
            type: "function_call",
            id: "fc_internal_id",
            call_id: "fc_internal_id",
            name: "run_automation",
            arguments: '{"automationId":"automation_1"}',
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_tool_id",
        name: "run_automation",
        content: '{"status":"completed","output":"done"}',
      },
    ])) as Array<Record<string, unknown>>;

    expect(result).toEqual([
      { role: "user", content: "run my digest" },
      {
        type: "function_call",
        call_id: "call_tool_id",
        name: "run_automation",
        arguments: '{"automationId":"automation_1"}',
      },
      {
        type: "function_call_output",
        call_id: "call_tool_id",
        output: '{"status":"completed","output":"done"}',
      },
    ]);
  });
});
