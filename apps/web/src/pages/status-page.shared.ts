import type { SystemStatusResponse } from "@nakama/core/contract";
import {
  Clock01Icon,
  HashtagIcon,
  Message01Icon,
  SlackIcon,
  SmartPhone01Icon,
  UserGroupIcon,
} from "hugeicons-react";

type ServiceStatusTone = "ok" | "warn" | "bad" | "muted";

type ServiceStatus = { status: string; tone: ServiceStatusTone };

export function buildServiceColumns(status: SystemStatusResponse) {
  const {
    automationWorker,
    telegramWorker,
    whatsappWorker,
    discordWorker,
    slackWorker,
    teamsWorker,
  } = status;

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
    {
      icon: SlackIcon,
      title: "Slack",
      // Same configured / running / paired shape as the Discord bridge.
      ...discordServiceStatus(slackWorker),
    },
    {
      icon: UserGroupIcon,
      title: "Microsoft Teams",
      ...teamsServiceStatus(teamsWorker),
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
): ServiceStatus {
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
): ServiceStatus {
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
): ServiceStatus {
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

/**
 * A running Teams worker is a local listener. Whether Microsoft can reach it
 * depends on the public messaging endpoint, which this status cannot see, so
 * it is never reported as online.
 */
function teamsServiceStatus(
  teamsWorker: SystemStatusResponse["teamsWorker"]
): ServiceStatus {
  if (!teamsWorker.configured) {
    return { status: "Not set up", tone: "muted" };
  }

  if (!teamsWorker.running) {
    return { status: "Offline", tone: "bad" };
  }

  if (!teamsWorker.paired) {
    return { status: "No users allowed", tone: "warn" };
  }

  return { status: "Listening locally", tone: "ok" };
}

function discordServiceStatus(
  discordWorker: SystemStatusResponse["discordWorker"]
): ServiceStatus {
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
