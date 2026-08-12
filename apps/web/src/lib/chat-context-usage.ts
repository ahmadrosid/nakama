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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatContextUsageLabel(usage: ChatContextUsage): string {
  const percent = Math.round(contextUsageRatio(usage) * 100);
  const sourceNote = usage.source === "estimate" ? " · estimated" : "";
  // "less context" rather than "saved", and always with a byte unit: this sits
  // beside two token counts, and a bare number there reads as tokens.
  // The percentage is what was asked for; the byte figure rides along because
  // this sits beside two token counts and a lone percentage there gets read as
  // a bill, not as output that never had to be sent.
  const optimizedNote =
    usage.bytesKeptOut && usage.bytesProduced
      ? ` · saved ${Math.round((100 * usage.bytesKeptOut) / usage.bytesProduced)}% (${formatBytes(usage.bytesKeptOut)})`
      : "";
  return `Context ${percent}% · ~${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.usableContextTokens)}${sourceNote}${optimizedNote}`;
}
