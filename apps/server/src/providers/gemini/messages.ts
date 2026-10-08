import {
  type Content,
  createPartFromFunctionResponse,
  createPartFromText,
  type Part,
} from "@google/genai";
import type { ChatMessage, LlmToolDefinition } from "@nakama/core";
import { resolveUserContentForProvider } from "@nakama/core";
import {
  type ProviderJsonRecord,
  readProviderString,
  readRecord,
} from "../shared";

export async function toGeminiContents(
  messages: ChatMessage[]
): Promise<Content[]> {
  const contents: Content[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const parts = await toGeminiUserParts(message.content);

      if (parts.length > 0) {
        contents.push({ parts, role: "user" });
      }

      continue;
    }

    if (message.role === "assistant") {
      const parts = toGeminiAssistantParts(message);

      if (parts.length > 0) {
        contents.push({ parts, role: "model" });
      }

      continue;
    }

    contents.push({
      parts: [toGeminiFunctionResponsePart(message)],
      role: "user",
    });
  }

  return contents;
}

/**
 * `createPartFromFunctionResponse` always writes the id, so an empty string
 * would still be sent. A response to a call the model issued without an id has
 * to carry none at all, which means building the part here.
 */
function toGeminiFunctionResponsePart(
  message: Extract<ChatMessage, { role: "tool" }>
): Part {
  const response = parseToolResultContent(message.content);

  if (isLocallyMintedGeminiCallId(message.toolCallId)) {
    return { functionResponse: { name: message.name, response } };
  }

  return createPartFromFunctionResponse(
    message.toolCallId,
    message.name,
    response
  );
}

async function toGeminiUserParts(
  content: string | import("@nakama/core").MessageContentPart[]
): Promise<Part[]> {
  const resolved = await resolveUserContentForProvider(content, "gemini");

  if (!Array.isArray(resolved)) {
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
        data: part.data,
        mimeType: part.mediaType,
      },
    });
  }

  return parts;
}

function toGeminiAssistantParts(
  message: Extract<ChatMessage, { role: "assistant" }>
): Part[] {
  if (
    message.providerContent?.some(
      (part) =>
        readProviderString(readRecord(part).thoughtSignature) !== undefined
    )
  ) {
    // SAFETY: Signatures belong to provider parts from Gemini responses.
    // Preserve the validated provider parts without rebuilding their signature data.
    return message.providerContent as Part[];
  }

  const parts: Part[] = [];
  const text = message.content.trim();

  if (text) {
    parts.push(createPartFromText(text));
  }

  for (const call of message.toolCalls ?? []) {
    const functionCall: NonNullable<Part["functionCall"]> = {
      args: call.arguments,
      name: call.name,
    };

    if (!isLocallyMintedGeminiCallId(call.id)) {
      functionCall.id = call.id;
    }

    parts.push({
      functionCall,
    });
  }

  return parts;
}

function parseToolResultContent(content: string): ProviderJsonRecord {
  const trimmed = content.trim();

  if (!trimmed) {
    return { output: "" };
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (parsed instanceof Object && !Array.isArray(parsed)) {
      // SAFETY: JSON.parse returns only JSON-compatible object values here.
      return parsed as ProviderJsonRecord;
    }
  } catch {
    // fall through
  }

  return { output: trimmed };
}

/**
 * Gemini 3 returns an `id` on every function call. Gemini 2.5 returns none, and
 * the id is optional in the API, so requiring one dropped every 2.5 tool call
 * and left the turn with no calls to run and nothing to say.
 *
 * The tool loop does need a handle to match a result back to its call, so one
 * is minted here. It is marked because it must never be sent back: the response
 * id has to match the call id, and the model issued neither.
 */
const LOCAL_CALL_ID_PREFIX = "gemini-local-";

function isLocallyMintedGeminiCallId(id: string | undefined): boolean {
  return Boolean(id?.startsWith(LOCAL_CALL_ID_PREFIX));
}

/**
 * Keyed by tool name so two different tools called in one turn stay apart while
 * streaming. Two calls to the same tool in one turn would still merge, which is
 * what the previous shared "pending" key did to every call regardless of name.
 */
export function localGeminiCallId(name: string): string {
  return `${LOCAL_CALL_ID_PREFIX}${name}`;
}

export function parseGeminiFunctionCalls(
  functionCalls:
    | Array<{
        id?: string;
        name?: string;
        args?: LlmToolDefinition["parameters"];
      }>
    | undefined
): import("@nakama/core").ToolCall[] {
  if (!functionCalls?.length) {
    return [];
  }

  return functionCalls.flatMap((call) => {
    const name = call.name?.trim();

    if (!name) {
      return [];
    }

    const id = call.id?.trim() || localGeminiCallId(name);

    return [
      {
        arguments: readRecord(call.args ?? {}),
        id,
        name,
      },
    ];
  });
}

interface ExtractedGeminiText {
  content: string;
  thinking?: string;
}

export function extractTextAndThinkingFromParts(
  parts: Part[] | undefined
): ExtractedGeminiText {
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

  const result: ExtractedGeminiText = {
    content: textParts.join(""),
  };

  if (thinking) {
    result.thinking = thinking;
  }

  return result;
}
