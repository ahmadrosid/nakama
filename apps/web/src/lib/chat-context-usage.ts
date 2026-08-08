import type { ChatContextUsage } from "@nakama/core/contract";

export type { ChatContextUsage };

export function contextUsageRatio(usage: ChatContextUsage): number {
  if (usage.usableContextTokens <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, usage.usedTokens / usage.usableContextTokens));
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return String(Math.max(0, Math.round(tokens)));
  }

  if (tokens < 10_000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }

  if (tokens < 1_000_000) {
    return `${Math.round(tokens / 1000)}k`;
  }

  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatContextUsageLabel(usage: ChatContextUsage): string {
  const percent = Math.round(contextUsageRatio(usage) * 100);
  const sourceNote = usage.source === "estimate" ? " · estimated" : "";
  return `Context ${percent}% · ~${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.usableContextTokens)}${sourceNote}`;
}
