import type {
  ChatMessage,
  CompactionResponse,
  LlmToolDefinition,
  ProviderClient,
} from "@nakama/core";
import {
  estimateUserContentTokens,
  stripImagesForCompaction,
} from "@nakama/core";

const COMPACTION_BUFFER = 20_000;
// Pruning thresholds are fractions of the model's usable context so that
// large-window models keep their history intact when tool output is small
// relative to the window, while small-window models still reclaim tokens
// before overflow. See #342.
const PRUNE_PROTECT_FRACTION = 0.5;
const PRUNE_MINIMUM_FRACTION = 0.1;
const TAIL_TURNS = 2;
const TOKEN_ESTIMATE_RATIO = 4;
const PRUNE_TRUNCATION = "[output truncated by compaction]";

const COMPACTION_SYSTEM =
  "You summarize conversation history for context continuity. Follow the user instructions exactly.";

const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`;

export interface CompactionConfig {
  contextWindow: number;
  maxOutputTokens: number;
}

export interface CompactHistoryInput {
  compaction: CompactionConfig;
  force?: boolean;
  history: ChatMessage[];
  provider: ProviderClient;
  systemPrompt: string;
  tools?: LlmToolDefinition[];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_ESTIMATE_RATIO);
}

function estimateMessageTokens(messages: readonly ChatMessage[]): number {
  let total = 0;

  for (const message of messages) {
    if (message.role === "user") {
      total += estimateUserContentTokens(message.content);
      continue;
    }

    if (message.role === "assistant") {
      // When providerContent is present it is what providers replay (#340).
      // Count it verbatim (thinking/reasoning included) and skip content/
      // toolCalls, which already live inside it. OpenAI tool turns can
      // diverge slightly: Responses rebuilds function_call items from
      // toolCalls and drops id/status; that gap is accepted deliberately
      // rather than making the estimator provider-aware.
      if (message.providerContent?.length) {
        total += estimateTokens(JSON.stringify(message.providerContent));
      } else {
        total += estimateTokens(message.content);

        // The chat-completions mapper replays this trace as reasoning_content.
        if (message.thinking) {
          total += estimateTokens(message.thinking);
        }

        if (message.toolCalls?.length) {
          total += estimateTokens(JSON.stringify(message.toolCalls));
        }
      }

      continue;
    }

    total += estimateTokens(message.content);
  }

  return total;
}

export function estimateHistoryTokens(
  messages: readonly ChatMessage[],
  systemPrompt: string,
  tools?: LlmToolDefinition[]
): number {
  return (
    estimateTokens(systemPrompt) +
    estimateMessageTokens(messages) +
    estimateTokens(JSON.stringify(tools ?? []))
  );
}

function reservedTokens(maxOutputTokens: number): number {
  return Math.min(COMPACTION_BUFFER, maxOutputTokens);
}

export function usableContextTokens(compaction: CompactionConfig): number {
  return compaction.contextWindow - reservedTokens(compaction.maxOutputTokens);
}

export function isOverflow(
  usedTokens: number,
  compaction: CompactionConfig
): boolean {
  return usedTokens >= usableContextTokens(compaction);
}

type Turn = {
  start: number;
  end: number;
};

function getTurns(messages: readonly ChatMessage[]): Turn[] {
  const turns: Turn[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") {
      turns.push({ end: messages.length, start: index });
    }
  }

  for (let index = 0; index < turns.length - 1; index += 1) {
    turns[index]!.end = turns[index + 1]!.start;
  }

  return turns;
}

function findPreviousSummary(
  messages: readonly ChatMessage[]
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      message?.role === "assistant" &&
      message.summary &&
      message.content.trim()
    ) {
      return message.content.trim();
    }
  }
}

export function buildCompactionPrompt(previousSummary?: string): string {
  const anchor = previousSummary
    ? [
        "Update the anchored summary below using the conversation history above.",
        "Preserve still-true details, remove stale details, and merge in the new facts.",
        "<previous-summary>",
        previousSummary,
        "</previous-summary>",
      ].join("\n")
    : "Create a new anchored summary from the conversation history above.";

  return `${anchor}\n\n${SUMMARY_TEMPLATE}`;
}

export function selectCompactionRange(
  messages: readonly ChatMessage[],
  tailTurns = TAIL_TURNS
): { head: ChatMessage[]; tailStartIndex: number } {
  const turns = getTurns(messages);

  if (turns.length <= tailTurns) {
    return { head: [], tailStartIndex: 0 };
  }

  const tailStartIndex = turns[turns.length - tailTurns]!.start;

  if (tailStartIndex <= 0) {
    return { head: [], tailStartIndex: 0 };
  }

  return {
    head: messages.slice(0, tailStartIndex),
    tailStartIndex,
  };
}

export function pruneToolOutputs(
  messages: ChatMessage[],
  compaction: CompactionConfig
): { prunedTokens: number } {
  const usable = usableContextTokens(compaction);
  const protect = Math.floor(usable * PRUNE_PROTECT_FRACTION);
  const minimum = Math.floor(usable * PRUNE_MINIMUM_FRACTION);

  // Degenerate configs (small contextWindow vs. maxOutputTokens) yield a
  // non-positive usable budget; pruning would have nothing to protect.
  if (usable <= 0) {
    return { prunedTokens: 0 };
  }

  let total = 0;
  let pruned = 0;
  const pruneIndexes: number[] = [];
  let turns = 0;

  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];

    if (!message) {
      continue;
    }

    if (message.role === "user") {
      turns += 1;
    }

    if (turns < 2) {
      continue;
    }

    if (message.role === "assistant" && message.summary) {
      break;
    }

    if (message.role !== "tool") {
      continue;
    }

    if (message.content === PRUNE_TRUNCATION) {
      break;
    }

    const estimate = estimateTokens(message.content);
    total += estimate;

    if (total <= protect) {
      continue;
    }

    pruned += estimate;
    pruneIndexes.push(messageIndex);
  }

  if (pruned <= minimum) {
    return { prunedTokens: 0 };
  }

  // Copy-on-write (#589): replace slots so in-flight providers keep originals.
  for (const index of pruneIndexes) {
    const message = messages[index];
    if (!message || message.role !== "tool") {
      continue;
    }
    messages[index] = { ...message, content: PRUNE_TRUNCATION };
  }

  return { prunedTokens: pruned };
}

export async function compactHistory(
  input: CompactHistoryInput
): Promise<CompactionResponse> {
  const messagesBefore = input.history.length;
  const { prunedTokens } = pruneToolOutputs(input.history, input.compaction);
  const usedTokens = estimateHistoryTokens(
    input.history,
    input.systemPrompt,
    input.tools
  );
  const overflow = isOverflow(usedTokens, input.compaction);
  const shouldSummarize = input.force === true || overflow;

  if (!shouldSummarize) {
    return {
      action: prunedTokens > 0 ? "pruned" : "none",
      messagesAfter: input.history.length,
      messagesBefore,
      prunedTokens: prunedTokens > 0 ? prunedTokens : undefined,
    };
  }

  const { head, tailStartIndex } = selectCompactionRange(input.history);

  if (head.length === 0) {
    return {
      action: prunedTokens > 0 ? "pruned" : "none",
      messagesAfter: input.history.length,
      messagesBefore,
      prunedTokens: prunedTokens > 0 ? prunedTokens : undefined,
    };
  }

  const previousSummary = findPreviousSummary(head);
  const compactionPrompt = buildCompactionPrompt(previousSummary);
  const result = await input.provider.generateChat({
    messages: [
      ...stripImagesForCompaction(head),
      { content: compactionPrompt, role: "user" },
    ],
    system: COMPACTION_SYSTEM,
  });

  const summaryMessage: Extract<ChatMessage, { role: "assistant" }> = {
    content: result.content.trim() || result.assistantMessage.content.trim(),
    role: "assistant",
    summary: true,
  };

  const tail = input.history.slice(tailStartIndex);
  input.history.splice(0, input.history.length, summaryMessage, ...tail);

  return {
    action: "summarized",
    messagesAfter: input.history.length,
    messagesBefore,
    prunedTokens: prunedTokens > 0 ? prunedTokens : undefined,
  };
}
