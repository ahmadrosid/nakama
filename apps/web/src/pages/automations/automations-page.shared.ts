import type {
  AutomationRunRecord,
  AutomationTrigger,
  StoredAutomation,
} from "@nakama/core/contract";
import { Cron } from "croner";
import { type ChatListItem, chatMessagesToListItems } from "@/lib/chat-history";

export function automationRunMessages(
  run: AutomationRunRecord
): ChatListItem[] {
  const running = run.status === "running";

  const transcript = run.progress?.length
    ? run.progress
    : run.output
      ? [{ content: run.output, role: "assistant" as const }]
      : [];

  const messages: ChatListItem[] = chatMessagesToListItems(transcript).map(
    (message) => ({
      ...message,
      createdAt: run.startedAt,
      streaming:
        running &&
        message.role === "assistant" &&
        message.historyIndex === transcript.length - 1,
      thinkingStreaming:
        running &&
        Boolean(message.thinking) &&
        !message.content &&
        message.historyIndex === transcript.length - 1,
      toolStatus:
        running && message.role === "tool" && !message.toolCompletedAt
          ? ("running" as const)
          : message.toolStatus,
    })
  );

  if (running && (!messages.length || messages.at(-1)?.role === "user")) {
    messages.push({
      content: "",
      createdAt: run.startedAt,
      id: `${run.id}-waiting`,
      role: "assistant",
      streaming: true,
      thinkingStreaming: false,
      toolStatus: undefined,
    });
  }

  if (run.error) {
    return [
      ...messages,
      {
        content: run.error,
        failed: true,
        id: `${run.id}-error`,
        role: "assistant",
      },
    ];
  }

  return messages;
}

const DAILY_CRON = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;

interface TriggerDescription {
  label: string;
  note?: string;
}

export function describeTrigger(
  trigger: AutomationTrigger
): TriggerDescription {
  if (trigger.type === "manual") {
    return { label: "Manual only", note: "Starts when you press Run now" };
  }

  if (trigger.type === "runAt") {
    return { label: `Once, ${trigger.at}`, note: trigger.timezone };
  }

  const daily = DAILY_CRON.exec(trigger.cron.trim());

  if (daily) {
    const time = new Date(2000, 0, 1, Number(daily[2]), Number(daily[1]));

    return {
      label: `Every day, ${time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
      note: trigger.timezone,
    };
  }

  return {
    label: "Custom schedule",
    note: [trigger.cron, trigger.timezone].filter(Boolean).join(" · "),
  };
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

  if (minutes >= 60) {
    const hourMinutes = minutes % 60;

    return hourMinutes > 0
      ? `${Math.floor(minutes / 60)}h ${hourMinutes}m`
      : `${Math.floor(minutes / 60)}h`;
  }

  const remainder = seconds % 60;

  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function readSchedulePreset(trigger: AutomationTrigger) {
  if (trigger.type !== "schedule") {
    return null;
  }

  const match =
    /^(\d|[0-5]\d) (\d|1\d|2[0-3]) (\*|[1-9]|[12]\d|3[01]) \* (\*|1-5|[0-6])$/.exec(
      trigger.cron.trim()
    );

  if (!match) {
    return null;
  }

  const [, minute, hour, day, weekday] = match;

  if (day !== "*" && weekday !== "*") {
    return null;
  }

  return {
    day,
    frequency:
      day === "*"
        ? weekday === "*"
          ? "daily"
          : weekday === "1-5"
            ? "weekdays"
            : "weekly"
        : "monthly",
    hour,
    minute,
    weekday,
  };
}

export function schedulePresetTrigger(
  frequency: string,
  trigger: AutomationTrigger
): AutomationTrigger {
  if (frequency === "manual") {
    return { type: "manual" };
  }

  const preset = readSchedulePreset(trigger);

  const day =
    frequency === "monthly"
      ? preset?.frequency === "monthly"
        ? preset.day
        : "1"
      : "*";

  const weekday =
    frequency === "weekdays"
      ? "1-5"
      : frequency === "weekly"
        ? preset?.frequency === "weekly"
          ? preset.weekday
          : "1"
        : "*";

  return {
    cron: `${preset?.minute ?? "0"} ${preset?.hour ?? "7"} ${day} * ${weekday}`,
    timezone: trigger.type === "manual" ? undefined : trigger.timezone,
    type: "schedule",
  };
}

export function previewAutomationSchedule(
  trigger: AutomationTrigger,
  timezone: string,
  now = new Date()
): string | null {
  if (trigger.type === "manual") {
    return null;
  }

  try {
    const next =
      trigger.type === "runAt"
        ? new Date(trigger.at)
        : new Cron(trigger.cron, { paused: true, timezone }).nextRun(now);

    if (!(next && Number.isFinite(next.getTime())) || next <= now) {
      return null;
    }

    const dateFormat = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone: timezone,
      year: "numeric",
    });

    const localNow = new Date(dateFormat.format(now));
    const localNext = new Date(dateFormat.format(next));

    const dayDifference = Math.round(
      (localNext.getTime() - localNow.getTime()) / 86_400_000
    );

    const day =
      dayDifference === 0
        ? "Today"
        : dayDifference === 1
          ? "Tomorrow"
          : next.toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
              timeZone: timezone,
              weekday: "short",
            });

    const time = next.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    });

    return `${day}, ${time}`;
  } catch {
    return null;
  }
}
