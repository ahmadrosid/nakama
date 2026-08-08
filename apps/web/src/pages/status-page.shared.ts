import type { SystemStatusResponse } from "@nakama/core/contract";
import {
  ClockIcon,
  HashIcon,
  type LucideIcon,
  MessageCircleIcon,
  SmartphoneIcon,
} from "lucide-react";
import { PAGE_PATHS } from "@/lib/navigation";

export type StatusTone = "ok" | "warn" | "bad";

type ServiceStatusTone = "ok" | "warn" | "bad" | "muted";

export function buildServiceColumns(status: SystemStatusResponse) {
  const { automationWorker, telegramWorker, whatsappWorker, discordWorker } =
    status;

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

  return { status: "Healthy", tone: "ok" };
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

  return { status: "Healthy", tone: "ok" };
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

  return { status: "Healthy", tone: "ok" };
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

  return { status: "Healthy", tone: "ok" };
}

export type StatusSummaryAction = {
  label: string;
  to: string;
};

export function deriveSummary(status: SystemStatusResponse): {
  tone: StatusTone;
  title: string;
  description: string;
  action?: StatusSummaryAction;
} {
  if (!status.server.ok) {
    return {
      description: "Restart Nakama and check your connection.",
      title: "Server offline",
      tone: "bad",
    };
  }

  if (!status.automationWorker.ok) {
    return {
      description: "Start the automation worker to resume scheduled runs.",
      title: "Automation worker stopped",
      tone: "bad",
    };
  }

  if (status.telegramWorker.configured && !status.telegramWorker.running) {
    return {
      action: { label: "Open Integrations", to: PAGE_PATHS.integrations },
      description:
        "Start the Telegram worker (bun run dev:telegram) to receive messages.",
      title: "Telegram bridge offline",
      tone: "warn",
    };
  }

  if (status.whatsappWorker.configured && !status.whatsappWorker.running) {
    return {
      action: { label: "Open Integrations", to: PAGE_PATHS.integrations },
      description: "Start the WhatsApp worker to receive messages.",
      title: "WhatsApp offline",
      tone: "warn",
    };
  }

  if (status.discordWorker.configured && !status.discordWorker.running) {
    return {
      action: { label: "Open Integrations", to: PAGE_PATHS.integrations },
      description:
        "Start the bridge worker from Integrations → Discord to receive messages.",
      title: "Discord bridge offline",
      tone: "warn",
    };
  }

  if (
    !(
      status.server.providerConfigured &&
      status.automationWorker.providerConfigured
    )
  ) {
    return {
      action: { label: "Open Settings", to: PAGE_PATHS.settings },
      description:
        "Configure an LLM provider before chat or automation runs can succeed.",
      title: "Running with warnings",
      tone: "warn",
    };
  }

  return {
    description: "Server, workers, and bridges are healthy.",
    title: "All systems operational",
    tone: "ok",
  };
}
