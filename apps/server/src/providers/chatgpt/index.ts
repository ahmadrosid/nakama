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
import { ProviderHttpError } from "../shared";
import { CHATGPT_CODEX_BASE_URL, refreshChatgptOAuthToken } from "./oauth";

export interface ChatgptProviderOptions {
  fallbacks?: ChatgptProviderOptions[];
  getOAuth: () => ChatgptOAuthCredentials | null;
  instanceId?: string;
  label?: string;
  model: string;
  onTokenRefresh?: (oauth: ChatgptOAuthCredentials) => Promise<void>;
}

const accountCooldowns = new Map<string, number>();
const accountsNeedingReauth = new Set<string>();
const ACCOUNT_COOLDOWN_MS = 60_000;

export function getChatgptAccountCooldowns(): Record<string, number> {
  const now = Date.now();
  for (const [id, until] of accountCooldowns) {
    if (until <= now) {
      accountCooldowns.delete(id);
    }
  }
  return Object.fromEntries(accountCooldowns);
}

export function chatgptAccountNeedsReauth(instanceId: string): boolean {
  return accountsNeedingReauth.has(instanceId);
}

export function clearChatgptAccountStatus(instanceId: string): void {
  accountCooldowns.delete(instanceId);
  accountsNeedingReauth.delete(instanceId);
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
    const candidates = [options, ...(options.fallbacks ?? [])];
    const unavailable: string[] = [];
    let lastError: unknown;

    for (const account of candidates) {
      const id = account.instanceId;
      if (id && (accountCooldowns.get(id) ?? 0) > Date.now()) {
        unavailable.push(account.label ?? "ChatGPT account");
        continue;
      }

      try {
        let oauth = await resolveAccessToken(account);
        const send = () =>
          generateOpenAIResponsesChat({
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
            stream: true,
            ...(handlers ? { handlers } : {}),
            supportsThinking: true,
          });
        let result: ChatCompletionResult;
        try {
          result = await send();
        } catch (error) {
          if (!(error instanceof ProviderHttpError) || error.status !== 401) {
            throw error;
          }
          try {
            oauth = await refreshChatgptOAuthToken(oauth.refreshToken);
            await account.onTokenRefresh?.(oauth);
          } catch (refreshError) {
            lastError = refreshError;
            if (id) {
              accountsNeedingReauth.add(id);
            }
            unavailable.push(account.label ?? "ChatGPT account");
            continue;
          }
          result = await send();
        }
        if (id) {
          accountCooldowns.delete(id);
          accountsNeedingReauth.delete(id);
        }
        return {
          ...result,
          ...(result.usage && id
            ? { usage: { ...result.usage, providerInstanceId: id } }
            : {}),
        };
      } catch (error) {
        lastError = error;
        if (error instanceof ProviderHttpError && error.status === 401) {
          if (id) {
            accountsNeedingReauth.add(id);
          }
          unavailable.push(account.label ?? "ChatGPT account");
          continue;
        }
        const retryable =
          error instanceof ProviderHttpError &&
          (error.status === 429 || error.code === "usage_limit_exceeded");
        if (!retryable || error.partialOutput) {
          throw error;
        }
        if (id) {
          const cooldownMs = error.retryAfterMs ?? ACCOUNT_COOLDOWN_MS;
          accountCooldowns.set(
            id,
            Date.now() + Math.min(Math.max(cooldownMs, 1000), 60 * 60_000)
          );
        }
        unavailable.push(account.label ?? "ChatGPT account");
      }
    }

    if (unavailable.length === candidates.length) {
      throw new Error(
        `All connected ChatGPT accounts are temporarily unavailable: ${unavailable.join(", ")}.`
      );
    }
    throw (
      lastError ?? new Error("No ChatGPT account is available for this model.")
    );
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
        ...(result.usage
          ? {
              usage: {
                ...result.usage,
                ...(result.usage.providerInstanceId
                  ? { providerInstanceId: result.usage.providerInstanceId }
                  : {}),
              },
            }
          : {}),
      };
    },
    name: "chatgpt",
    streamChat(input, handlers) {
      return runChat(input, handlers);
    },
  };
}
