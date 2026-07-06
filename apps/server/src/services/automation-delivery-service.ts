import type {
  AutomationRunRecord,
  StoredAutomation,
} from "@nakama/core";
import {
  createEmailOutboundAdapter,
  createTelegramOutboundAdapter,
  createWhatsAppOutboundAdapter,
  formatAutomationDeliveryMessage,
  truncateForChannel,
  shouldDeliverForRun,
} from "@nakama/core";
import type {
  EmailOutboundAdapter,
  TelegramOutboundAdapter,
  WhatsAppOutboundAdapter,
} from "@nakama/core";
import type { AutomationService } from "./automation-service";

export interface AutomationDeliveryServiceOptions {
  email?: EmailOutboundAdapter;
  telegram?: TelegramOutboundAdapter;
  whatsapp?: WhatsAppOutboundAdapter;
}

export class AutomationDeliveryService {
  private readonly email: EmailOutboundAdapter;
  private readonly telegram: TelegramOutboundAdapter;
  private readonly whatsapp: WhatsAppOutboundAdapter;

  constructor(
    private readonly automationService: AutomationService,
    options: AutomationDeliveryServiceOptions = {},
  ) {
    this.email = options.email ?? createEmailOutboundAdapter();
    this.telegram = options.telegram ?? createTelegramOutboundAdapter();
    this.whatsapp = options.whatsapp ?? createWhatsAppOutboundAdapter();
  }

  async deliver(automation: StoredAutomation, run: AutomationRunRecord): Promise<void> {
    const delivery = automation.delivery;

    if (!delivery) {
      return;
    }

    if (!shouldDeliverForRun(delivery, run.status)) {
      await this.automationService.updateRunDelivery(run.id, automation.id, {
        deliveryStatus: "skipped",
        deliveryError: null,
      });
      return;
    }

    const bodySource = run.status === "failed" ? (run.error ?? run.output) : run.output;
    const body = truncateForChannel(bodySource?.trim() || "(no output)", delivery.channel);
    const completedAt = run.completedAt ?? new Date().toISOString();
    const formatted = formatAutomationDeliveryMessage({
      automationName: automation.name,
      status: run.status,
      completedAt,
      body,
    });

    let result: { ok: boolean; error?: string };

    if (delivery.channel === "email") {
      result = await this.email.send({
        to: delivery.to!.trim(),
        subject: formatted.subject,
        text: formatted.text,
        profileId: automation.profileId,
        orgId: automation.orgId,
      });
    } else if (delivery.channel === "telegram") {
      result = await this.telegram.send({
        text: formatted.text,
        chatIds: delivery.chatId ? [delivery.chatId] : undefined,
      });
    } else {
      result = await this.whatsapp.send({ text: formatted.text });
    }

    await this.automationService.updateRunDelivery(run.id, automation.id, {
      deliveryStatus: result.ok ? "sent" : "failed",
      deliveryError: result.ok ? null : (result.error ?? "Delivery failed."),
    });
  }
}
