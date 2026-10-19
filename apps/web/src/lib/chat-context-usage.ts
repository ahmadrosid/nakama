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

/** One decimal for thousands so the popover header can show ~60.5k, not 61k. */
export function formatTokenCountDetailed(tokens: number): string {
  const value = Math.max(0, tokens);

  if (value < 1000) {
    return String(Math.round(value));
  }

  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }

  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export type ContextUsageSegment = {
  colorClass: string;
  id: string;
  label: string;
  tokens: number;
};

const SEGMENT_META = [
  {
    colorClass: "bg-zinc-400 dark:bg-zinc-500",
    id: "systemPrompt",
    label: "System prompt",
  },
  {
    colorClass: "bg-violet-500",
    id: "toolDefinitions",
    label: "Tool definitions",
  },
  {
    colorClass: "bg-rose-900",
    id: "conversation",
    label: "Conversation",
  },
] as const;

export function contextUsageSegments(
  usage: ChatContextUsage
): ContextUsageSegment[] {
  const used = Math.max(0, usage.usedTokens);
  const breakdown = usage.breakdown;

  if (!breakdown) {
    return used > 0
      ? [
          {
            colorClass: "bg-rose-900",
            id: "used",
            label: "Used",
            tokens: used,
          },
        ]
      : [];
  }

  const parts: ContextUsageSegment[] = SEGMENT_META.flatMap((meta) => {
    const tokens = breakdown[meta.id];

    return tokens > 0 ? [{ ...meta, tokens }] : [];
  });

  const estimated = parts.reduce((sum, part) => sum + part.tokens, 0);

  if (used > estimated && used - estimated >= 1) {
    parts.push({
      colorClass: "bg-sky-600",
      id: "other",
      label: "Other",
      tokens: used - estimated,
    });
  }

  return parts;
}

export function formatContextUsageLabel(usage: ChatContextUsage): string {
  const percent = Math.round(contextUsageRatio(usage) * 100);
  const sourceNote = usage.source === "estimate" ? " · estimated" : "";

  return `Context ${percent}% · ~${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.usableContextTokens)}${sourceNote}`;
}
