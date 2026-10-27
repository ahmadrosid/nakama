import type { AutomationRunStatus } from "../contract";

const TELEGRAM_MAX_LENGTH = 4096;

const WHATSAPP_MAX_LENGTH = 4096;

const EMAIL_BODY_MAX_LENGTH = 100_000;

/** For channels whose adapter cannot split long text into several messages. */
export function truncateForChannel(
  text: string,
  channel: "email" | "whatsapp"
): string {
  const max = channel === "email" ? EMAIL_BODY_MAX_LENGTH : WHATSAPP_MAX_LENGTH;

  if (text.length <= max) {
    return text;
  }

  const suffix = "\n\n… (truncated)";

  return `${text.slice(0, max - suffix.length)}${suffix}`;
}

export function formatAutomationDeliveryMessage(options: {
  automationName: string;
  status: AutomationRunStatus;
  completedAt: string;
  body: string;
}): AutomationDeliveryMessage {
  const label = options.status === "failed" ? "failed" : "completed";
  const subject = `[Nakama] ${options.automationName} — ${label}`;

  const text = [
    subject,
    options.completedAt,
    "",
    options.body.trim() || "(no output)",
  ].join("\n");

  return { subject, text };
}

interface AutomationDeliveryMessage {
  subject: string;
  text: string;
}

export function splitTelegramChunks(
  text: string,
  maxLength = TELEGRAM_MAX_LENGTH
): string[] {
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxLength) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let remaining = trimmed;
  // Opening line of a code fence that the previous chunk closed early.
  let openFence: string | null = null;

  while (remaining) {
    const prefix = openFence === null ? "" : `${openFence}\n`;

    if (prefix.length + remaining.length <= maxLength) {
      chunks.push(prefix + remaining);
      break;
    }

    const budget = Math.max(1, maxLength - prefix.length - FENCE_CLOSE.length);
    const splitAt = findSplitIndex(remaining, budget);
    const body = remaining.slice(0, splitAt).trimEnd();
    const fenceAfter = fenceStateAfter(body, openFence);

    chunks.push(`${prefix}${body}${fenceAfter === null ? "" : FENCE_CLOSE}`);
    openFence = fenceAfter;

    let rest = remaining.slice(splitAt);

    if (rest.startsWith("\n") || rest.startsWith(" ")) {
      rest = rest.slice(1);
    }

    // Keep code indentation; outside a fence, drop extra blank space.
    remaining = openFence === null ? rest.trimStart() : rest;
  }

  return chunks;
}

const FENCE_CLOSE = "\n```";

/** Last newline in the budget, else last space, else a hard cut. */
function findSplitIndex(text: string, budget: number): number {
  const newline = text.lastIndexOf("\n", budget);

  if (newline >= budget / 2) {
    return newline;
  }

  const splitAt = Math.max(newline, text.lastIndexOf(" ", budget));

  return splitAt > 0 ? splitAt : budget;
}

/** Fence opening line still open after `body`, or null when closed. */
function fenceStateAfter(
  body: string,
  openFence: string | null
): string | null {
  let state = openFence;

  for (const line of body.split("\n")) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("```")) {
      state = state === null ? trimmedLine : null;
    }
  }

  return state;
}
