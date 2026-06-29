import type { AutomationDeliveryChannel, AutomationRunStatus } from "../contract";

const TELEGRAM_MAX_LENGTH = 4096;
const WHATSAPP_MAX_LENGTH = 4096;
const EMAIL_BODY_MAX_LENGTH = 100_000;

export function truncateForChannel(text: string, channel: AutomationDeliveryChannel): string {
  const max =
    channel === "email"
      ? EMAIL_BODY_MAX_LENGTH
      : channel === "telegram"
        ? TELEGRAM_MAX_LENGTH
        : WHATSAPP_MAX_LENGTH;

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
}): { subject: string; text: string } {
  const label = options.status === "failed" ? "failed" : "completed";
  const subject = `[TinyClaw] ${options.automationName} — ${label}`;
  const text = [
    subject,
    options.completedAt,
    "",
    options.body.trim() || "(no output)",
  ].join("\n");

  return { subject, text };
}

export function splitTelegramChunks(text: string, maxLength = TELEGRAM_MAX_LENGTH): string[] {
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxLength) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);

    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}
