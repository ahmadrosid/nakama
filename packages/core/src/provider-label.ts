import type { ProviderName } from "./contract";

const BUILTIN_LABELS: Record<
  Exclude<ProviderName, "openai_compatible">,
  string
> = {
  anthropic: "Anthropic",
  cerebras: "Cerebras",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  gemini: "Gemini",
  ollama: "Ollama",
  openai: "OpenAI",
  opencode_go: "OpenCode Go",
  openrouter: "OpenRouter",
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
