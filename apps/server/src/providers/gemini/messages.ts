import {
  createPartFromFunctionResponse,
  createPartFromText,
  type Content,
  type Part,
} from "@google/genai";
import type { ChatMessage } from "@tinyclaw/core";
import { resolveUserContentForProvider } from "@tinyclaw/core";
import { readRecord } from "../shared";

export async function toGeminiContents(messages: ChatMessage[]): Promise<Content[]> {
  const contents: Content[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const parts = await toGeminiUserParts(message.content);

      if (parts.length > 0) {
        contents.push({ role: "user", parts });
      }

      continue;
    }

    if (message.role === "assistant") {
      const parts = toGeminiAssistantParts(message);

      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }

      continue;
    }

    contents.push({
      role: "user",
      parts: [
        createPartFromFunctionResponse(
          message.toolCallId,
          message.name,
          parseToolResultContent(message.content),
        ),
      ],
    });
  }

  return contents;
}

async function toGeminiUserParts(
  content: string | import("@tinyclaw/core").MessageContentPart[],
): Promise<Part[]> {
  const resolved = await resolveUserContentForProvider(content, "gemini");

  if (typeof resolved === "string") {
    const trimmed = resolved.trim();
    return trimmed ? [createPartFromText(trimmed)] : [];
  }

  const parts: Part[] = [];

  for (const part of resolved) {
    if (part.type === "text") {
      const trimmed = part.text.trim();

      if (trimmed) {
        parts.push(createPartFromText(trimmed));
      }

      continue;
    }

    parts.push({
      inlineData: {
        mimeType: part.mediaType,
        data: part.data,
      },
    });
  }

  return parts;
}

function toGeminiAssistantParts(
  message: Extract<ChatMessage, { role: "assistant" }>,
): Part[] {
  const parts: Part[] = [];
  const text = message.content.trim();

  if (text) {
    parts.push(createPartFromText(text));
  }

  for (const call of message.toolCalls ?? []) {
    parts.push({
      functionCall: {
        id: call.id,
        name: call.name,
        args: call.arguments,
      },
    });
  }

  return parts;
}

function parseToolResultContent(content: string): Record<string, unknown> {
  const trimmed = content.trim();

  if (!trimmed) {
    return { output: "" };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }

  return { output: trimmed };
}

export function parseGeminiFunctionCalls(
  functionCalls:
    | Array<{ id?: string; name?: string; args?: Record<string, unknown> }>
    | undefined,
): import("@tinyclaw/core").ToolCall[] {
  if (!functionCalls?.length) {
    return [];
  }

  return functionCalls.flatMap((call) => {
    const id = call.id?.trim();
    const name = call.name?.trim();

    if (!id || !name) {
      return [];
    }

    return [
      {
        id,
        name,
        arguments: readRecord(call.args ?? {}),
      },
    ];
  });
}

export function extractTextAndThinkingFromParts(
  parts: Part[] | undefined,
): { content: string; thinking?: string } {
  if (!parts?.length) {
    return { content: "" };
  }

  const textParts: string[] = [];
  const thinkingParts: string[] = [];

  for (const part of parts) {
    const text = part.text?.trim();

    if (!text) {
      continue;
    }

    if (part.thought) {
      thinkingParts.push(text);
    } else {
      textParts.push(text);
    }
  }

  const thinking = thinkingParts.join("").trim();

  return {
    content: textParts.join(""),
    ...(thinking ? { thinking } : {}),
  };
}
