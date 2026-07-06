import { ApiError, GoogleGenAI, type GenerateContentResponse, type Part } from "@google/genai";
import type {
  ChatCompletionResult,
  GenerateChatInput,
  GenerateTextResult,
  GenerateTextInput,
  ProviderClient,
  StreamChatHandlers,
} from "@nakama/core";
import { buildGeminiChatConfig, buildGeminiGenerateConfig } from "./config";
import {
  extractTextAndThinkingFromParts,
  parseGeminiFunctionCalls,
  toGeminiContents,
} from "./messages";
import { buildChatCompletionResult, extractGeminiTokenUsage } from "../shared";

const PROVIDER_LABEL = "Gemini";
const DEFAULT_MODEL = "gemini-2.5-flash";

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

function createGeminiClient(apiKey: string, baseUrl?: string): GoogleGenAI {
  const trimmed = baseUrl?.trim();
  return new GoogleGenAI({
    apiKey,
    ...(trimmed ? { httpOptions: { baseUrl: trimmed } } : {}),
  });
}

function formatGeminiError(error: unknown): Error {
  if (error instanceof ApiError) {
    return new Error(
      `${PROVIDER_LABEL} request failed (${error.status}): ${error.message}`,
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`${PROVIDER_LABEL} request failed.`);
}

async function withGeminiError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw formatGeminiError(error);
  }
}

function parseGenerateContentResponse(
  response: GenerateContentResponse,
): ChatCompletionResult {
  const parts = response.candidates?.[0]?.content?.parts;
  const { content, thinking } = extractTextAndThinkingFromParts(parts);
  const toolCalls = parseGeminiFunctionCalls(response.functionCalls);

  if (!content.trim() && toolCalls.length === 0 && !thinking) {
    throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
  }

  return buildChatCompletionResult({
    content,
    toolCalls,
    thinking,
    usage: extractGeminiTokenUsage(
      (response as unknown as { usageMetadata?: Record<string, unknown> }).usageMetadata,
    ),
  });
}

interface PendingFunctionCall {
  id: string;
  name: string;
  argsJson: string;
}

function mergePendingFunctionCall(
  pending: Map<string, PendingFunctionCall>,
  call: { id?: string; name?: string; args?: Record<string, unknown> },
): void {
  const id = call.id?.trim() || "pending";
  const current = pending.get(id) ?? { id, name: "", argsJson: "{}" };

  if (call.name) {
    current.name = call.name;
  }

  if (call.args) {
    current.argsJson = JSON.stringify(call.args);
  }

  pending.set(id, current);
}

function finalizePendingFunctionCalls(
  pending: Map<string, PendingFunctionCall>,
): ReturnType<typeof parseGeminiFunctionCalls> {
  return [...pending.values()].flatMap((call) => {
    if (!call.id || !call.name) {
      return [];
    }

    return parseGeminiFunctionCalls([
      {
        id: call.id,
        name: call.name,
        args: JSON.parse(call.argsJson) as Record<string, unknown>,
      },
    ]);
  });
}

function accumulateStreamParts(
  parts: Part[] | undefined,
  state: { content: string; thinking: string },
  handlers?: StreamChatHandlers,
): void {
  if (!parts?.length) {
    return;
  }

  for (const part of parts) {
    const text = part.text;

    if (!text) {
      if (part.functionCall) {
        handlers?.onToolStart?.({
          toolCallId: part.functionCall.id ?? "pending",
          tool: part.functionCall.name ?? "",
          input: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }

      continue;
    }

    if (part.thought) {
      state.thinking += text;
      handlers?.onThinking?.(text);
    } else {
      state.content += text;
      handlers?.onChunk(text);
    }
  }
}

async function readGeminiStream(
  stream: AsyncGenerator<GenerateContentResponse>,
  handlers: StreamChatHandlers,
): Promise<ChatCompletionResult> {
  const state = { content: "", thinking: "" };
  const pending = new Map<string, PendingFunctionCall>();
  let usage: ChatCompletionResult["usage"];

  for await (const chunk of stream) {
    usage =
      extractGeminiTokenUsage(
        (chunk as unknown as { usageMetadata?: Record<string, unknown> }).usageMetadata,
      ) ?? usage;
    const parts = chunk.candidates?.[0]?.content?.parts;
    accumulateStreamParts(parts, state, handlers);

    for (const call of chunk.functionCalls ?? []) {
      mergePendingFunctionCall(pending, call);
    }
  }

  const toolCalls = finalizePendingFunctionCalls(pending);
  const thinking = state.thinking.trim() || undefined;

  if (!state.content.trim() && toolCalls.length === 0 && !thinking) {
    throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
  }

  return buildChatCompletionResult({
    content: state.content,
    toolCalls,
    thinking,
    usage,
  });
}

export function createGeminiProvider(
  options: GeminiProviderOptions,
): ProviderClient {
  const model = options.model ?? DEFAULT_MODEL;
  const client = createGeminiClient(options.apiKey, options.baseUrl);

  return {
    name: "gemini",
    generateText(input: GenerateTextInput) {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? `${input.system}\n\nRespond with valid JSON only.`
        : `${input.system}\n\nReturn only the requested text. No JSON, labels, or markdown fences.`;

      return withGeminiError(async () => {
        const response = await client.models.generateContent({
          model,
          contents: input.prompt,
          config: buildGeminiGenerateConfig({
            system,
            model,
            responseMimeType: useJson ? "application/json" : undefined,
          }),
        });

        const content = response.text?.trim();
        const usage = extractGeminiTokenUsage(
          (response as unknown as { usageMetadata?: Record<string, unknown> }).usageMetadata,
        );

        if (!content) {
          throw new Error(`${PROVIDER_LABEL} returned an empty response.`);
        }

        return {
          content,
          ...(usage ? { usage } : {}),
        } satisfies GenerateTextResult;
      });
    },
    generateChat(input: GenerateChatInput) {
      return withGeminiError(async () => {
        const response = await client.models.generateContent({
          model,
          contents: await toGeminiContents(input.messages),
          config: buildGeminiChatConfig(input, input.system, model),
        });

        return parseGenerateContentResponse(response);
      });
    },
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      return withGeminiError(async () => {
        const stream = await client.models.generateContentStream({
          model,
          contents: await toGeminiContents(input.messages),
          config: buildGeminiChatConfig(input, input.system, model),
        });

        return readGeminiStream(stream, handlers);
      });
    },
  };
}

export { toGeminiContents } from "./messages";
