import {
  ClockIcon,
  HashIcon,
  MessageCircleIcon,
  SmartphoneIcon,
  type LucideIcon,
} from "lucide-react";
import type { SystemStatusResponse } from "@nakama/core/contract";

export type StatusTone = "ok" | "warn" | "bad";

type ServiceStatusTone = "ok" | "warn" | "bad" | "muted";

export function buildServiceColumns(status: SystemStatusResponse) {
  const { automationWorker, telegramWorker, whatsappWorker, discordWorker } = status;

  return [
    {
      icon: ClockIcon,
      title: "Automation",
      ...automationServiceStatus(automationWorker),
    },
    {
      icon: MessageCircleIcon,
      title: "Telegram",
      ...telegramServiceStatus(telegramWorker),
    },
    {
      icon: SmartphoneIcon,
      title: "WhatsApp",
      ...whatsappServiceStatus(whatsappWorker),
    },
    {
      icon: HashIcon,
      title: "Discord",
      ...discordServiceStatus(discordWorker),
    },
  ] satisfies Array<{
    icon: LucideIcon;
    title: string;
    status: string;
    tone: ServiceStatusTone;
  }>;
}

function automationServiceStatus(
  automationWorker: SystemStatusResponse["automationWorker"],
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

  return { status: "Healthy", tone: "ok" };
}

function telegramServiceStatus(
  telegramWorker: SystemStatusResponse["telegramWorker"],
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

  return { status: "Healthy", tone: "ok" };
}

function whatsappServiceStatus(
  whatsappWorker: SystemStatusResponse["whatsappWorker"],
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

  return { status: "Healthy", tone: "ok" };
}

function discordServiceStatus(
  discordWorker: SystemStatusResponse["discordWorker"],
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

  return { status: "Healthy", tone: "ok" };
}

export function deriveSummary(status: SystemStatusResponse): {
  tone: StatusTone;
  title: string;
  description: string;
} {
  if (!status.server.ok) {
    return {
      tone: "bad",
      title: "Server offline",
      description: "Restart Nakama and check your connection.",
    };
  }

  if (!status.automationWorker.ok) {
    return {
      tone: "bad",
      title: "Automation worker stopped",
      description: "Start the automation worker to resume scheduled runs.",
    };
  }

  if (status.telegramWorker.configured && !status.telegramWorker.running) {
    return {
      tone: "warn",
      title: "Telegram bridge offline",
      description: "Start the Telegram worker (bun run dev:telegram) to receive messages.",
    };
  }

  if (status.whatsappWorker.configured && !status.whatsappWorker.running) {
    return {
      tone: "warn",
      title: "WhatsApp offline",
      description: "Start the WhatsApp worker to receive messages.",
    };
  }

  if (status.discordWorker.configured && !status.discordWorker.running) {
    return {
      tone: "warn",
      title: "Discord bridge offline",
      description: "Start the bridge worker from Integrations → Discord to receive messages.",
    };
  }

  if (!status.server.providerConfigured || !status.automationWorker.providerConfigured) {
    return {
      tone: "warn",
      title: "Running with warnings",
      description: "Configure an LLM provider before chat or automation runs can succeed.",
    };
  }

  return {
    tone: "ok",
    title: "All systems operational",
    description: "Server, workers, and bridges are healthy.",
  };
}
