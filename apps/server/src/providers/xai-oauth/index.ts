import type {
  ChatCompletionResult,
  GenerateChatInput,
  GenerateTextInput,
  GenerateTextResult,
  ProviderClient,
  StreamChatHandlers,
  XaiOAuthCredentials,
} from "@nakama/core";
import { generateOpenAIResponsesChat } from "../openai/responses";
import {
  resolveXaiOAuthCredentials,
  XAI_OAUTH_BASE_URL,
  XAI_OAUTH_HEADERS,
} from "./oauth";

export interface XaiProviderOptions {
  getOAuth: () => XaiOAuthCredentials | null;
  model: string;
  onTokenRefresh?: (oauth: XaiOAuthCredentials) => Promise<void>;
}

export function createXaiProvider(options: XaiProviderOptions): ProviderClient {
  const model = options.model;

  async function runChat(
    input: GenerateChatInput,
    handlers?: StreamChatHandlers
  ): Promise<ChatCompletionResult> {
    const oauth = await resolveXaiOAuthCredentials(
      options.getOAuth,
      async (refreshed) => {
        await options.onTokenRefresh?.(refreshed);
      }
    );

    return generateOpenAIResponsesChat({
      apiKey: oauth.accessToken,
      baseUrl: XAI_OAUTH_BASE_URL,
      extraHeaders: XAI_OAUTH_HEADERS,
      input,
      label: "Grok",
      model,
      stream: Boolean(handlers),
      ...(handlers ? { handlers } : {}),
      supportsThinking:
        model.startsWith("grok-4.6") ||
        model.startsWith("grok-4.5") ||
        model.includes("multi-agent"),
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
        throw new Error("Grok returned an empty response.");
      }

      return {
        content,
        ...(result.usage ? { usage: result.usage } : {}),
      };
    },
    name: "xai_oauth",
    streamChat(input, handlers) {
      return runChat(input, handlers);
    },
  };
}
