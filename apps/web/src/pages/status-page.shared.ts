import type { SystemStatusResponse } from "@nakama/core/contract";
import {
  Clock01Icon,
  HashtagIcon,
  Message01Icon,
  SmartPhone01Icon,
} from "hugeicons-react";

type ServiceStatusTone = "ok" | "warn" | "bad" | "muted";

export function buildServiceColumns(status: SystemStatusResponse) {
  const { automationWorker, telegramWorker, whatsappWorker, discordWorker } =
    status;

  return [
    {
      icon: Clock01Icon,
      title: "Automation",
      ...automationServiceStatus(automationWorker),
    },
    {
      icon: Message01Icon,
      title: "Telegram",
      ...telegramServiceStatus(telegramWorker),
    },
    {
      icon: SmartPhone01Icon,
      title: "WhatsApp",
      ...whatsappServiceStatus(whatsappWorker),
    },
    {
      icon: HashtagIcon,
      title: "Discord",
      ...discordServiceStatus(discordWorker),
    },
  ] satisfies Array<{
    icon: typeof Clock01Icon;
    title: string;
    status: string;
    tone: ServiceStatusTone;
  }>;
}

function automationServiceStatus(
  automationWorker: SystemStatusResponse["automationWorker"]
): { status: string; tone: ServiceStatusTone } {
  if (!automationWorker.process?.managed) {
    return { status: "PM2 unavailable", tone: "warn" };
  }

  if (!automationWorker.running) {
    return { status: "Offline", tone: "bad" };
  }

  if (automationWorker.activeRuns > 0) {
    return { status: "Running jobs", tone: "ok" };
  }

  return { status: "Online", tone: "ok" };
}

function telegramServiceStatus(
  telegramWorker: SystemStatusResponse["telegramWorker"]
): { status: string; tone: ServiceStatusTone } {
  if (!telegramWorker.configured) {
    return { status: "Not set up", tone: "muted" };
  }

  if (!telegramWorker.running) {
    return { status: "Offline", tone: "bad" };
  }

  if (!telegramWorker.paired) {
    return { status: "Awaiting pairing", tone: "warn" };
  }

  return { status: "Online", tone: "ok" };
}

function whatsappServiceStatus(
  whatsappWorker: SystemStatusResponse["whatsappWorker"]
): { status: string; tone: ServiceStatusTone } {
  if (!whatsappWorker.configured) {
    return { status: "Not set up", tone: "muted" };
  }

  if (!whatsappWorker.running) {
    return { status: "Offline", tone: "bad" };
  }

  if (!whatsappWorker.paired) {
    return { status: "Awaiting pairing", tone: "warn" };
  }

  return { status: "Online", tone: "ok" };
}

function discordServiceStatus(
  discordWorker: SystemStatusResponse["discordWorker"]
): { status: string; tone: ServiceStatusTone } {
  if (!discordWorker.configured) {
    return { status: "Not set up", tone: "muted" };
  }

  if (!discordWorker.running) {
    return { status: "Offline", tone: "bad" };
  }

  if (!discordWorker.paired) {
    return { status: "Awaiting pairing", tone: "warn" };
  }

  return { status: "Online", tone: "ok" };
}
