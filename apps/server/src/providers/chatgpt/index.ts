import type {
  ChatCompletionResult,
  GenerateChatInput,
  GenerateTextInput,
  GenerateTextResult,
  ProviderClient,
  StreamChatHandlers,
} from "@nakama/core";
import {
  type ChatgptOAuthCredentials,
  chatgptOAuthNeedsRefresh,
} from "@nakama/core";
import { generateOpenAIResponsesChat } from "../openai/responses";
import { CHATGPT_CODEX_BASE_URL, refreshChatgptOAuthToken } from "./oauth";

export interface ChatgptProviderOptions {
  getOAuth: () => ChatgptOAuthCredentials | null;
  model: string;
  onTokenRefresh?: (oauth: ChatgptOAuthCredentials) => Promise<void>;
}

async function resolveAccessToken(
  options: ChatgptProviderOptions
): Promise<ChatgptOAuthCredentials> {
  const current = options.getOAuth();

  if (!current) {
    throw new Error(
      "ChatGPT provider is not connected. Reconnect in Settings → LLM providers."
    );
  }

  if (!chatgptOAuthNeedsRefresh(current)) {
    return current;
  }

  const refreshed = await refreshChatgptOAuthToken(current.refreshToken);
  await options.onTokenRefresh?.(refreshed);
  return refreshed;
}

export function createChatgptProvider(
  options: ChatgptProviderOptions
): ProviderClient {
  const model = options.model;

  async function runChat(
    input: GenerateChatInput,
    handlers?: StreamChatHandlers
  ): Promise<ChatCompletionResult> {
    const oauth = await resolveAccessToken(options);

    return generateOpenAIResponsesChat({
      apiKey: oauth.accessToken,
      baseUrl: CHATGPT_CODEX_BASE_URL,
      extraHeaders: {
        "ChatGPT-Account-ID": oauth.accountId,
        "OpenAI-Beta": "responses=v1",
        originator: "nakama",
        version: "1.0.0",
      },
      input,
      label: "ChatGPT",
      model,
      // Codex rejects non-streaming /responses calls.
      stream: true,
      ...(handlers ? { handlers } : {}),
      supportsThinking: true,
    });
  }

  return {
    generateChat(input) {
      return runChat(input);
    },
    async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
      const useJson = (input.format ?? "json") === "json";
      const system = useJson
        ? `${input.system}\n\nRespond with valid JSON only.`
        : `${input.system}\n\nReturn only the requested text. No JSON, labels, or markdown fences.`;

      const result = await runChat({
        messages: [{ content: input.prompt, role: "user" }],
        system,
      });
      const content = result.content.trim();

      if (!content) {
        throw new Error("ChatGPT returned an empty response.");
      }

      return {
        content,
        ...(result.usage ? { usage: result.usage } : {}),
      };
    },
    name: "chatgpt",
    streamChat(input, handlers) {
      return runChat(input, handlers);
    },
  };
}
