import { createHash, randomUUID } from "node:crypto";
import type {
  GenerateChatInput,
  GenerateTextInput,
  ProviderClient,
  StreamChatHandlers,
} from "@nakama/core";
import { createAnthropicProvider } from "../anthropic";
import { createOpenAIProvider } from "../openai";

const OPENCODE_GO_CHAT_BASE_URL = "https://opencode.ai/zen/go/v1";

const OPENCODE_GO_MESSAGES_BASE_URL = "https://opencode.ai/zen/go";

/** The provider routes by this value, so it must stay a safe header size. */
const MAX_SESSION_ID_LENGTH = 64;

const SESSION_HASH_LENGTH = 12;

const UNSAFE_SESSION_CHARS = /[^a-zA-Z0-9_-]/g;

const MESSAGES_MODELS = new Set([
  "opencode-go/minimax-m3",
  "opencode-go/minimax-m2.7",
  "opencode-go/minimax-m2.5",
  "opencode-go/qwen3.7-max",
  "opencode-go/qwen3.7-plus",
  "opencode-go/qwen3.6-plus",
  "opencode-go/qwen3.5-plus",
]);

export interface OpenCodeGoProviderOptions {
  apiKey: string;
  model?: string;
  sessionId?: string;
}

/**
 * OpenCode Go routes each conversation by `x-opencode-session`, so every
 * branch goes through the sanitizer: an unsanitized value with a CR/LF or a
 * non-ASCII character makes `fetch` throw before the request is sent, and an
 * unbounded value has no size cap.
 *
 * A changed or cut ID gets a hash of the original, so two different IDs
 * (`a:b` and `a_b`) do not share one route.
 */
export function formatOpenCodeSessionId(sessionId?: string): string {
  const raw = (sessionId ?? "").trim().replace(/^ses_/, "");

  if (!raw) {
    return `ses_${randomUUID().replace(/-/g, "")}`;
  }

  const sanitized = raw.replace(UNSAFE_SESSION_CHARS, "_");

  if (sanitized === raw && raw.length <= MAX_SESSION_ID_LENGTH) {
    return `ses_${raw}`;
  }

  const hash = createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, SESSION_HASH_LENGTH);

  const head = sanitized.slice(
    0,
    MAX_SESSION_ID_LENGTH - SESSION_HASH_LENGTH - 1
  );

  return `ses_${head}_${hash}`;
}

export function createOpenCodeGoProvider(
  options: OpenCodeGoProviderOptions
): ProviderClient {
  const model = options.model ?? "opencode-go/kimi-k2.7-code";
  const useMessages = MESSAGES_MODELS.has(model);

  const extraHeaders = {
    "x-opencode-session": formatOpenCodeSessionId(options.sessionId),
  };

  if (useMessages) {
    const anthropic = createAnthropicProvider({
      apiKey: options.apiKey,
      baseUrl: OPENCODE_GO_MESSAGES_BASE_URL,
      extraHeaders,
      model,
      providerLabel: "OpenCode Go",
      providerName: "opencode_go",
    });

    return {
      generateChat: (input: GenerateChatInput) =>
        anthropic.generateChat({ ...input, providerOptions: undefined }),
      generateText: (input: GenerateTextInput) => anthropic.generateText(input),
      name: "opencode_go",
      streamChat: (input: GenerateChatInput, handlers: StreamChatHandlers) =>
        anthropic.streamChat(
          { ...input, providerOptions: undefined },
          handlers
        ),
    };
  }

  return createOpenAIProvider({
    apiKey: options.apiKey,
    baseUrl: OPENCODE_GO_CHAT_BASE_URL,
    extraHeaders,
    model,
    providerName: "opencode_go",
  });
}
