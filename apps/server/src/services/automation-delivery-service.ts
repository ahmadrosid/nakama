import type {
  AutomationRunRecord,
  DiscordOutboundAdapter,
  EmailOutboundAdapter,
  StoredAutomation,
  TelegramOutboundAdapter,
  WhatsAppOutboundAdapter,
} from "@nakama/core";
import {
  createDiscordOutboundAdapter,
  createEmailOutboundAdapter,
  createTelegramOutboundAdapter,
  createWhatsAppOutboundAdapter,
  formatAutomationDeliveryMessage,
  shouldDeliverForRun,
  truncateForChannel,
} from "@nakama/core";
import type { AutomationService } from "./automation-service";

export interface AutomationDeliveryServiceOptions {
  discord?: DiscordOutboundAdapter;
  email?: EmailOutboundAdapter;
  telegram?: TelegramOutboundAdapter;
  whatsapp?: WhatsAppOutboundAdapter;
}

export class AutomationDeliveryService {
  private readonly discord: DiscordOutboundAdapter;
  private readonly email: EmailOutboundAdapter;
  private readonly telegram: TelegramOutboundAdapter;
  private readonly whatsapp: WhatsAppOutboundAdapter;

  constructor(
    private readonly automationService: AutomationService,
    options: AutomationDeliveryServiceOptions = {}
  ) {
    this.discord = options.discord ?? createDiscordOutboundAdapter();
    this.email = options.email ?? createEmailOutboundAdapter();
    this.telegram = options.telegram ?? createTelegramOutboundAdapter();
    this.whatsapp = options.whatsapp ?? createWhatsAppOutboundAdapter();
  }

  async deliver(
    automation: StoredAutomation,
    run: AutomationRunRecord
  ): Promise<void> {
    const delivery = automation.delivery;

    if (!delivery) {
      return;
    }

    if (!shouldDeliverForRun(delivery, run.status)) {
      await this.automationService.updateRunDelivery(run.id, automation.id, {
        deliveryError: null,
        deliveryStatus: "skipped",
      });
      return;
    }

    const bodySource =
      run.status === "failed" ? (run.error ?? run.output) : run.output;
    const body = truncateForChannel(
      bodySource?.trim() || "(no output)",
      delivery.channel
    );
    const completedAt = run.completedAt ?? new Date().toISOString();
    const formatted = formatAutomationDeliveryMessage({
      automationName: automation.name,
      body,
      completedAt,
      status: run.status,
    });

    let result: { ok: boolean; error?: string };

    if (delivery.channel === "email") {
      const to = delivery.to?.trim();
      if (!to) {
        throw new Error(
          "delivery.to is required when delivery.channel is email."
        );
      }
      result = await this.email.send({
        orgId: automation.orgId,
        profileId: automation.profileId,
        subject: formatted.subject,
        text: formatted.text,
        to,
      });
    } else if (delivery.channel === "telegram") {
      result = await this.telegram.send({
        chatIds: delivery.chatId ? [delivery.chatId] : undefined,
        text: formatted.text,
      });
    } else if (delivery.channel === "discord") {
      result = await this.discord.send({
        channelId: delivery.channelId,
        text: formatted.text,
      });
    } else {
      result = await this.whatsapp.send({ text: formatted.text });
    }

    await this.automationService.updateRunDelivery(run.id, automation.id, {
      deliveryError: result.ok ? null : (result.error ?? "Delivery failed."),
      deliveryStatus: result.ok ? "sent" : "failed",
    });
  }
}
