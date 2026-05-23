import type {
  GenerateChatInput,
  GenerateTextInput,
  ProviderClient,
  StreamChatHandlers,
} from "@tinyclaw/core";
import { continueAnthropicUntilDone } from "./anthropic-web-search";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
}

const ANTHROPIC_VERSION = "2023-06-01";

export function createAnthropicProvider(
  options: AnthropicProviderOptions,
): ProviderClient {
  const model = options.model ?? "claude-sonnet-4-6";

  return {
    name: "anthropic",
    generateText(input: GenerateTextInput) {
      return requestMessage({
        apiKey: options.apiKey,
        model,
        system: `${input.system}\n\nRespond with valid JSON only.`,
        messages: [{ role: "user", content: input.prompt }],
      });
    },
    generateChat(input: GenerateChatInput) {
      return continueAnthropicUntilDone({
        apiKey: options.apiKey,
        model,
        system: input.system,
        messages: input.messages,
        tools: input.tools,
        webSearch: input.providerOptions?.webSearch ?? false,
        stream: false,
      });
    },
    streamChat(input: GenerateChatInput, handlers: StreamChatHandlers) {
      return continueAnthropicUntilDone({
        apiKey: options.apiKey,
        model,
        system: input.system,
        messages: input.messages,
        tools: input.tools,
        webSearch: input.providerOptions?.webSearch ?? false,
        stream: true,
        handlers,
      });
    },
  };
}

async function requestMessage(options: {
  apiKey: string;
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": options.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: 2048,
      system: options.system,
      messages: options.messages,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic request failed (${response.status}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };

  const content = payload.content
    ?.filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();

  if (!content) {
    throw new Error("Anthropic returned an empty response.");
  }

  return content;
}
