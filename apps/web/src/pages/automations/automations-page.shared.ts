import type {
  AutomationRunRecord,
  AutomationRunStatus,
  AutomationTrigger,
  StoredAutomation,
} from "@nakama/core/contract";

export const sectionClass = "rounded-md border border-border bg-card";

export function formatTrigger(trigger: AutomationTrigger): string {
  if (trigger.type === "manual") {
    return "Manual trigger";
  }

  if (trigger.type === "runAt") {
    return `One-time · ${trigger.at}${trigger.timezone ? ` (${trigger.timezone})` : ""}`;
  }

  return `Schedule · ${trigger.cron}${trigger.timezone ? ` (${trigger.timezone})` : ""}`;
}

export function summarizeAutomationListMeta(automation: StoredAutomation): string {
  if (automation.trigger.type === "manual") {
    return "Manual run";
  }

  if (automation.trigger.type === "runAt") {
    return "One-time run";
  }

  return "Scheduled automation";
}

export function groupRunsByDay(
  runs: AutomationRunRecord[],
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

  return Array.from(buckets, ([label, groupedRuns]) => ({ label, runs: groupedRuns }));
}

export function formatRunDayLabel(value: string): string {
  const date = new Date(value);
  const now = new Date();

  if (Number.isNaN(date.getTime())) {
    return "Earlier";
  }

  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDate) / 86_400_000);

  if (diffDays === 0) {
    return "Today";
  }

  if (diffDays === 1) {
    return "Yesterday";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function runHistoryShellClass(status: AutomationRunStatus): string {
  if (status === "failed") {
    return "border-destructive/30";
  }

  if (status === "running") {
    return "border-border/80";
  }

  return "border-border/60";
}

export function runPreviewText(run: AutomationRunRecord): string | null {
  if (run.status === "running" && !run.output?.trim() && !run.error?.trim()) {
    return "Run in progress…";
  }

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

export function formatRunDuration(startedAt: string, completedAt: string | null): string | null {
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
