import type {
  AutomationRunRecord,
  AutomationTrigger,
  ChatMessage,
  StoredAutomation,
} from "@nakama/core/contract";
import { segmentAssistantTurn } from "@/components/chat/assistant-tool-group.shared";
import { chatMessagesToListItems } from "@/lib/chat-history";
import {
  formatToolResult,
  formatToolSummary,
  isToolResultError,
} from "@/lib/chat-stream";

export function automationProgressLines(messages: ChatMessage[]) {
  return segmentAssistantTurn(chatMessagesToListItems(messages)).flatMap<{
    id: string;
    text: string;
    type: "text" | "tool" | "error";
  }>((segment) => {
    if (segment.kind === "text") {
      return [
        {
          id: segment.message.id,
          text: segment.message.content,
          type: "text" as const,
        },
      ];
    }
    const running = segment.tools.filter((tool) => !tool.toolCompletedAt);
    const completed = segment.tools.length - running.length;
    const errors = segment.tools.flatMap((tool) => {
      const output = formatToolResult(tool.tool, tool.toolResult);
      return tool.toolCompletedAt && isToolResultError(tool.toolResult, output)
        ? [
            {
              id: `${tool.id}-error`,
              text: `✗ ${tool.tool}: ${(output ?? "Failed").replace(/\s+/g, " ").slice(0, 160)}`,
              type: "error" as const,
            },
          ]
        : [];
    });
    const active = running[0];
    const summary = active
      ? `⠋ ${active.tool}  ${formatToolSummary(active.tool, active.toolInput) ?? ""} · ${completed} done${running.length > 1 ? ` · ${running.length} running` : ""}`
      : `${errors.length ? "✗" : "✓"} ${completed} ${completed === 1 ? "tool" : "tools"} completed${errors.length ? ` · ${errors.length} failed` : ""}`;
    return [
      ...errors,
      {
        id: `${segment.groupId}-summary`,
        text: summary.replace(/\s+/g, " ").trim(),
        type: "tool" as const,
      },
    ];
  });
}

export const agentWorkPanelClassName =
  "flex min-h-0 flex-1 flex-col overflow-hidden";

export function formatTrigger(trigger: AutomationTrigger): string {
  if (trigger.type === "manual") {
    return "Manual trigger";
  }

  if (trigger.type === "runAt") {
    return `One-time · ${trigger.at}${trigger.timezone ? ` (${trigger.timezone})` : ""}`;
  }

  return `Schedule · ${trigger.cron}${trigger.timezone ? ` (${trigger.timezone})` : ""}`;
}

export function summarizeAutomationListMeta(
  automation: StoredAutomation
): string {
  if (automation.trigger.type === "manual") {
    return "Manual run";
  }

  if (automation.trigger.type === "runAt") {
    return "One-time run";
  }

  return "Scheduled automation";
}

export function groupRunsByDay(
  runs: AutomationRunRecord[]
): Array<{ label: string; runs: AutomationRunRecord[] }> {
  const buckets = new Map<string, AutomationRunRecord[]>();

  for (const run of runs) {
    const label = formatRunDayLabel(run.startedAt);
    const bucket = buckets.get(label);
    if (bucket) {
      bucket.push(run);
    } else {
      buckets.set(label, [run]);
    }
  }

  return Array.from(buckets, ([label, groupedRuns]) => ({
    label,
    runs: groupedRuns,
  }));
}

export function formatRunDayLabel(value: string): string {
  const date = new Date(value);
  const now = new Date();

  if (Number.isNaN(date.getTime())) {
    return "Earlier";
  }

  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const diffDays = Math.round((startOfToday - startOfDate) / 86_400_000);

  if (diffDays === 0) {
    return "Today";
  }

  if (diffDays === 1) {
    return "Yesterday";
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function runPreviewText(run: AutomationRunRecord): string | null {
  if (run.status === "failed" && run.error?.trim()) {
    return run.error.trim();
  }

  const source = run.output?.trim() || run.error?.trim();

  if (!source) {
    return null;
  }

  const plain = source
    .split("\n")
    .map((line) => stripMarkdownForPreview(line))
    .filter(Boolean)
    .join(" ");

  return truncatePlainText(plain, 200);
}

function stripMarkdownForPreview(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function truncatePlainText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

export function formatRunDuration(
  startedAt: string,
  completedAt: string | null
): string | null {
  if (!completedAt) {
    return null;
  }

  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(completedAt).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null;
  }

  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
