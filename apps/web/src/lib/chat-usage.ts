import type { ChatUsage } from "@nakama/core/contract";

export const CHAT_USAGE_VISIBLE_KEY = "nakama-chat-usage-visible";

/** Defaults to hidden; only an explicit "true" shows it. */
export function getInitialChatUsageVisible(): boolean {
  try {
    return localStorage.getItem(CHAT_USAGE_VISIBLE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Sums two usages; cost is dropped when either side has no known pricing. */
export function addChatUsage(
  left: ChatUsage | undefined,
  right: ChatUsage | undefined
): ChatUsage | undefined {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  const costKnown = left.costUsd != null && right.costUsd != null;

  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    ...(left.estimated || right.estimated ? { estimated: true } : {}),
    ...(costKnown
      ? { costUsd: (left.costUsd ?? 0) + (right.costUsd ?? 0) }
      : {}),
  };
}

/** Usage of every assistant message in one turn (tool loops make several LLM calls). */
export function sumChatUsage(
  messages: ReadonlyArray<{ role: string; usage?: ChatUsage }>
): ChatUsage | undefined {
  let total: ChatUsage | undefined;

  for (const message of messages) {
    if (message.role === "assistant") {
      total = addChatUsage(total, message.usage);
    }
  }

  return total;
}

export function formatUsd(amount: number): string {
  if (amount === 0) {
    return "$0.00";
  }

  if (amount < 0.01) {
    return `$${amount.toFixed(4)}`;
  }

  if (amount < 1) {
    return `$${amount.toFixed(3)}`;
  }

  return `$${amount.toFixed(2)}`;
}

/**
 * Locale pinned to English on purpose: the caller asked for k/m/b/t, and other
 * locales compact differently (German "Mio.", Japanese 万 on a 10k scale).
 */
const compactTokenFormat = new Intl.NumberFormat("en", { notation: "compact" });

/** 945 · 1.2k · 12k · 1.2m · 1.5b · 2.3t */
export function formatCompactTokens(tokens: number): string {
  return compactTokenFormat.format(tokens).toLowerCase();
}

export function formatChatUsageCost(usage: ChatUsage): string | null {
  if (usage.costUsd == null) {
    return null;
  }

  return `${usage.estimated ? "~" : ""}${formatUsd(usage.costUsd)}`;
}

export function formatChatUsage(usage: ChatUsage): string {
  const tokens = `${formatCompactTokens(usage.inputTokens)} in · ${formatCompactTokens(usage.outputTokens)} out`;
  const cost = usage.costUsd == null ? "" : ` · ${formatUsd(usage.costUsd)}`;

  return `${usage.estimated ? "~" : ""}${tokens}${cost}`;
}

export function chatUsageTitle(usage: ChatUsage): string {
  const parts = [
    `${usage.totalTokens.toLocaleString()} tokens for this reply`,
    usage.costUsd == null
      ? "cost unknown (no pricing for this model)"
      : "estimated API cost",
  ];

  if (usage.estimated) {
    parts.push("token counts estimated from text length");
  }

  return parts.join(" · ");
}
