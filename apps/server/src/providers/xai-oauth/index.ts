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
import { resolveXaiOAuthCredentials, XAI_OAUTH_BASE_URL } from "./oauth";

export interface XaiProviderOptions {
  getOAuth: () => XaiOAuthCredentials | null;
  model: string;
  onTokenRefresh?: (oauth: XaiOAuthCredentials) => Promise<void>;
}

export function createXaiProvider(options: XaiProviderOptions): ProviderClient {
  const model = options.model;
  let cached: XaiOAuthCredentials | null = null;
  let refreshedFrom: string | undefined;

  async function runChat(
    input: GenerateChatInput,
    handlers?: StreamChatHandlers
  ): Promise<ChatCompletionResult> {
    const previous = options.getOAuth();
    const oauth = await resolveXaiOAuthCredentials(
      () => {
        const current = options.getOAuth();
        return current?.refreshToken === refreshedFrom ? cached : current;
      },
      async (refreshed) => {
        await options.onTokenRefresh?.(refreshed);
      }
    );

    refreshedFrom = previous?.refreshToken;
    cached = oauth;

    return generateOpenAIResponsesChat({
      apiKey: oauth.accessToken,
      baseUrl: XAI_OAUTH_BASE_URL,
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
