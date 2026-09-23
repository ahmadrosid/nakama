import {
  ApiError,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
} from "@google/genai";
import type {
  ChatCompletionResult,
  GenerateChatInput,
  GenerateTextInput,
  GenerateTextResult,
  ProviderClient,
  StreamChatHandlers,
} from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import {
  buildChatCompletionResult,
  extractGeminiTokenUsage,
  notifyToolInputDelta,
} from "../shared";
import { buildGeminiChatConfig, buildGeminiGenerateConfig } from "./config";
import {
  extractTextAndThinkingFromParts,
  localGeminiCallId,
  parseGeminiFunctionCalls,
  toGeminiContents,
} from "./messages";

const PROVIDER_LABEL = "Gemini";
const DEFAULT_MODEL = "gemini-2.5-flash";

export interface GeminiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

function createGeminiClient(apiKey: string, baseUrl?: string): GoogleGenAI {
  const trimmed = baseUrl?.trim();
  return new GoogleGenAI({
    apiKey,
    ...(trimmed ? { httpOptions: { baseUrl: trimmed } } : {}),
  });
}

/**
 * Finish reasons where the model decided not to answer. Retrying sends the same
 * prompt to the same policy, so it is a refusal to report rather than a server
 * fault to hide behind a 500.
 */
const REFUSAL_FINISH_REASONS = new Set([
  "BLOCKLIST",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "RECITATION",
  "SAFETY",
  "SPII",
]);

/** Marks the one empty-response shape worth a second attempt. */
const RETRYABLE_EMPTY = Symbol("gemini.retryableEmptyResponse");

function isRetryableEmptyResponse(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && RETRYABLE_EMPTY in error
  );
}

/**
 * An empty candidate has several causes that need different handling, and the
 * old message collapsed them into one string. `MAX_TOKENS` means the budget ran
 * out before a part was emitted, a refusal means the model declined, and no
 * reason at all is the transient case that a retry actually fixes.
 */
function emptyResponseError(finishReason: unknown): Error {
  const reason = typeof finishReason === "string" ? finishReason : "";

  if (REFUSAL_FINISH_REASONS.has(reason)) {
    // 422, not 500: the request reached the model and the model said no.
    return new NakamaApiError(
      `${PROVIDER_LABEL} declined to answer (finishReason: ${reason}). Rephrasing may help; retrying the same prompt will not.`,
      422
    );
  }

  const error = new Error(
    reason
      ? `${PROVIDER_LABEL} returned an empty response (finishReason: ${reason}).`
      : `${PROVIDER_LABEL} returned an empty response with no finishReason.`
  );

  if (!reason) {
    Object.defineProperty(error, RETRYABLE_EMPTY, { value: true });
  }

  return error;
}

function formatGeminiError(error: unknown): Error {
  if (error instanceof ApiError) {
    return new Error(
      `${PROVIDER_LABEL} request failed (${error.status}): ${error.message}`
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

/**
 * One retry, and only for an empty response that carried no finishReason.
 *
 * Safe on the streaming path for the same reason it is needed there: the guard
 * fires only when nothing was emitted, so no chunk has reached the caller and a
 * second attempt cannot duplicate text. A reason of MAX_TOKENS or a refusal is
 * deterministic and is left to fail on the first attempt.
 */
async function withEmptyResponseRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isRetryableEmptyResponse(error)) {
      throw error;
    }

    return await run();
  }
}

function parseGenerateContentResponse(
  response: GenerateContentResponse
): ChatCompletionResult {
  const parts = response.candidates?.[0]?.content?.parts;
  const { content, thinking } = extractTextAndThinkingFromParts(parts);
  const toolCalls = parseGeminiFunctionCalls(response.functionCalls);

  if (!content.trim() && toolCalls.length === 0 && !thinking) {
    throw emptyResponseError(response.candidates?.[0]?.finishReason);
  }

  return buildChatCompletionResult({
    content,
    providerContent: parts?.some((part) => part.thoughtSignature)
      ? parts
      : undefined,
    thinking,
    toolCalls,
    usage: extractGeminiTokenUsage(response.usageMetadata),
  });
}

interface PendingFunctionCall {
  argsJson: string;
  id: string;
  name: string;
}

function mergePendingFunctionCall(
  pending: Map<string, PendingFunctionCall>,
  call: { id?: string; name?: string; args?: Record<string, unknown> },
  handlers?: StreamChatHandlers
): void {
  // Gemini 2.5 sends no call id, so one is minted from the tool name. The old
  // shared "pending" key merged every unnamed call into a single entry.
  const id = call.id?.trim() || localGeminiCallId(call.name?.trim() ?? "");
  const current = pending.get(id) ?? { argsJson: "{}", id, name: "" };

  if (call.name) {
    current.name = call.name;
  }

  if (call.args) {
    const nextJson = JSON.stringify(call.args);
    const delta =
      nextJson.length > current.argsJson.length
        ? nextJson.slice(current.argsJson.length)
        : nextJson;
    current.argsJson = nextJson;
    notifyToolInputDelta(
      handlers,
      { arguments: current.argsJson, id: current.id, name: current.name },
      delta
    );
  }

  pending.set(id, current);
}

function finalizePendingFunctionCalls(
  pending: Map<string, PendingFunctionCall>
): ReturnType<typeof parseGeminiFunctionCalls> {
  return [...pending.values()].flatMap((call) => {
    if (!(call.id && call.name)) {
      return [];
    }

    return parseGeminiFunctionCalls([
      {
        args: JSON.parse(call.argsJson) as Record<string, unknown>,
        id: call.id,
        name: call.name,
      },
    ]);
  });
}

function accumulateStreamParts(
  parts: Part[] | undefined,
  state: { content: string; thinking: string },
  handlers?: StreamChatHandlers
): void {
  if (!parts?.length) {
    return;
  }

  for (const part of parts) {
    const text = part.text;

    if (!text) {
      if (part.functionCall) {
        handlers?.onToolStart?.({
          input: (part.functionCall.args ?? {}) as Record<string, unknown>,
          tool: part.functionCall.name ?? "",
          toolCallId:
            part.functionCall.id ??
            localGeminiCallId(part.functionCall.name ?? ""),
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
  handlers: StreamChatHandlers
): Promise<ChatCompletionResult> {
  const state = { content: "", thinking: "" };
  const providerContent: Part[] = [];
  const pending = new Map<string, PendingFunctionCall>();
  let usage: ChatCompletionResult["usage"];
  let finishReason: unknown;

  for await (const chunk of stream) {
    usage = extractGeminiTokenUsage(chunk.usageMetadata) ?? usage;
    finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
    const parts = chunk.candidates?.[0]?.content?.parts;
    providerContent.push(...(parts ?? []));
    accumulateStreamParts(parts, state, handlers);

    for (const call of chunk.functionCalls ?? []) {
      mergePendingFunctionCall(pending, call, handlers);
    }
  }

  const toolCalls = finalizePendingFunctionCalls(pending);
  const thinking = state.thinking.trim() || undefined;

  if (!state.content.trim() && toolCalls.length === 0 && !thinking) {
    throw emptyResponseError(finishReason);
  }

  return buildChatCompletionResult({
    content: state.content,
    providerContent: providerContent.some((part) => part.thoughtSignature)
      ? providerContent
      : undefined,
    thinking,
    toolCalls,
    usage,
  });
}

export function createGeminiProvider(
  options: GeminiProviderOptions
): ProviderClient {
  const model = options.model ?? DEFAULT_MODEL;
  const client = createGeminiClient(options.apiKey, options.baseUrl);

  return {
    generateChat(input: GenerateChatInput) {
      return withEmptyResponseRetry(() =>
        withGeminiError(async () => {
          const response = await client.models.generateContent({
            config: {
              ...buildGeminiChatConfig(input, input.system, model),
              abortSignal: input.signal,
            },
            contents: await toGeminiContents(input.messages),
            model,
          });

          return parseGenerateContentResponse(response);
        })
      );
    },
    generateText(input: GenerateTextInput) {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? `${input.system}\n\nRespond with valid JSON only.`
        : `${input.system}\n\nReturn only the requested text. No JSON, labels, or markdown fences.`;

      return withGeminiError(async () => {
        const response = await client.models.generateContent({
          config: buildGeminiGenerateConfig({
            model,
            responseMimeType: useJson ? "application/json" : undefined,
            system,
          }),
          contents: input.prompt,
          model,
        });

        const content = response.text?.trim();
        const usage = extractGeminiTokenUsage(response.usageMetadata);

        if (!content) {
          throw emptyResponseError(response.candidates?.[0]?.finishReason);
        }

        return {
          content,
          ...(usage ? { usage } : {}),
        } satisfies GenerateTextResult;
      });
    },
    name: "gemini",
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      return withEmptyResponseRetry(() =>
        withGeminiError(async () => {
          const stream = await client.models.generateContentStream({
            config: {
              ...buildGeminiChatConfig(input, input.system, model),
              abortSignal: input.signal,
            },
            contents: await toGeminiContents(input.messages),
            model,
          });

          return readGeminiStream(stream, handlers);
        })
      );
    },
  };
}

export { toGeminiContents } from "./messages";
