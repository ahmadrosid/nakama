import type { ProviderName } from "./contract";

const BUILTIN_LABELS: Record<
  Exclude<ProviderName, "openai_compatible">,
  string
> = {
  anthropic: "Anthropic",
  cerebras: "Cerebras",
  chatgpt: "ChatGPT (Plus/Pro)",
  cloudflare: "Cloudflare Worker AI",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  gemini: "Gemini",
  minimax: "MiniMax",
  minimax_cn: "MiniMax (CN)",
  mistral: "Mistral",
  ollama: "Ollama",
  openai: "OpenAI",
  opencode_go: "OpenCode Go",
  openrouter: "OpenRouter",
  xai: "xAI Grok",
  xai_oauth: "Grok (SuperGrok / Premium+)",
  zhipu: "GLM (Z.ai)",
  zhipu_cn: "GLM (CN)",
};

export function formatConfiguredProviderLabel(
  provider: ProviderName | null | undefined,
  displayName?: string | null
): string {
  if (!provider) {
    return "Provider";
  }

  if (provider === "openai_compatible") {
    const trimmed = displayName?.trim();
    return trimmed || "Custom provider";
  }

  return BUILTIN_LABELS[provider];
}
