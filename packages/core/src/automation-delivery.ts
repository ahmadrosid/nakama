import {
  type AutomationDeliveryAccess,
  assertDiscordBotCanPostToChannel,
  assertTelegramBotCanPostToChat,
  automationDeliveryDestinationForbidden,
  canApproveAutomationDeliveryDestination,
  isTelegramDeliveryChatAuthorized,
} from "./automation-delivery-destination";
import type {
  AutomationDelivery,
  AutomationDeliveryNotifyOn,
  AutomationRunStatus,
} from "./contract";
import { isDiscordSnowflake, loadDiscordConfigFile } from "./discord-config";
import { isEmailConfigComplete, loadEmailConfig } from "./email-config";
import { loadTelegramConfigFile } from "./telegram-config";
import { loadWhatsAppConfigFile } from "./whatsapp-config";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAutomationDelivery(
  value: unknown
): AutomationDelivery | undefined {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value !== "object" || value === null) {
    throw new Error("delivery must be an object.");
  }

  const record = value as Record<string, unknown>;
  const channel = record.channel;

  if (
    channel !== "telegram" &&
    channel !== "whatsapp" &&
    channel !== "email" &&
    channel !== "discord"
  ) {
    throw new Error(
      'delivery.channel must be "telegram", "whatsapp", "email", or "discord".'
    );
  }

  const delivery: AutomationDelivery = { channel };

  if (record.to !== undefined) {
    if (channel !== "email") {
      throw new Error(
        "delivery.to is only valid when delivery.channel is email."
      );
    }

    if (typeof record.to !== "string" || !record.to.trim()) {
      throw new Error("delivery.to must be a non-empty string.");
    }

    delivery.to = record.to.trim();
  }

  if (record.chatId !== undefined) {
    if (channel !== "telegram") {
      throw new Error(
        "delivery.chatId is only valid when delivery.channel is telegram."
      );
    }

    if (
      typeof record.chatId !== "number" ||
      !Number.isInteger(record.chatId) ||
      record.chatId <= 0
    ) {
      throw new Error("delivery.chatId must be a positive integer.");
    }

    delivery.chatId = record.chatId;
  }

  if (record.channelId !== undefined) {
    if (channel !== "discord") {
      throw new Error(
        "delivery.channelId is only valid when delivery.channel is discord."
      );
    }

    if (typeof record.channelId !== "string" || !record.channelId.trim()) {
      throw new Error("delivery.channelId must be a non-empty string.");
    }

    const channelId =
      /discord(?:app)?\.com\/channels\/[^/]+\/(\d{17,20})/i.exec(
        record.channelId.trim()
      )?.[1] ?? record.channelId.trim();

    if (!isDiscordSnowflake(channelId)) {
      throw new Error(
        "delivery.channelId must be a Discord snowflake or channel URL."
      );
    }

    delivery.channelId = channelId;
  }

  if (record.notifyOn !== undefined) {
    if (
      record.notifyOn !== "success" &&
      record.notifyOn !== "failure" &&
      record.notifyOn !== "both"
    ) {
      throw new Error(
        'delivery.notifyOn must be "success", "failure", or "both".'
      );
    }

    delivery.notifyOn = record.notifyOn;
  }

  return delivery;
}

export function resolveDeliveryNotifyOn(
  delivery: AutomationDelivery
): AutomationDeliveryNotifyOn {
  return delivery.notifyOn ?? "success";
}

export function shouldDeliverForRun(
  delivery: AutomationDelivery,
  status: AutomationRunStatus
): boolean {
  const notifyOn = resolveDeliveryNotifyOn(delivery);

  if (status === "running") {
    return false;
  }

  if (notifyOn === "both") {
    return status === "completed" || status === "failed";
  }

  if (notifyOn === "failure") {
    return status === "failed";
  }

  return status === "completed";
}

export interface ValidateAutomationDeliveryOptions {
  access?: AutomationDeliveryAccess;
  fetchImpl?: typeof fetch;
  isEmailConfigured?: () => Promise<boolean> | boolean;
  orgId: string;
  /** Destination already stored for this automation, if any. */
  previousDelivery?: AutomationDelivery;
  profileId?: string;
}

/**
 * A destination an admin already approved stays approved, so a member editing
 * an automation's name cannot be blocked by an override they never set.
 */
function hasSameDeliveryDestination(
  delivery: AutomationDelivery,
  previous: AutomationDelivery | undefined
): boolean {
  return (
    previous?.channel === delivery.channel &&
    previous.chatId === delivery.chatId &&
    previous.channelId === delivery.channelId
  );
}

export async function validateAutomationDelivery(
  delivery: AutomationDelivery | undefined,
  options: ValidateAutomationDeliveryOptions
): Promise<void> {
  if (!delivery) {
    return;
  }

  if (delivery.channel !== "email" && !options.profileId) {
    throw new Error("Choose an agent connection for delivery.");
  }
  const owner = { orgId: options.orgId, profileId: options.profileId! };
  const isApprover = canApproveAutomationDeliveryDestination(options.access);
  const mayOverrideDestination =
    isApprover ||
    hasSameDeliveryDestination(delivery, options.previousDelivery);
  if (delivery.channel === "telegram") {
    const config = await loadTelegramConfigFile(owner);
    const botToken = config?.botToken.trim();

    if (!(config && botToken)) {
      throw new Error(
        "Telegram is not configured. Set up Integrations → Telegram first."
      );
    }

    if (delivery.chatId === undefined) {
      if (config.pairedUserIds.length === 0) {
        throw new Error(
          "Telegram is not paired. Link your account in Integrations → Telegram first."
        );
      }

      return;
    }

    // A member may only pin delivery to a chat the org already paired or
    // allowlisted; anything else needs an admin plus a provider-side check.
    if (!isTelegramDeliveryChatAuthorized(delivery.chatId, config)) {
      if (!mayOverrideDestination) {
        throw automationDeliveryDestinationForbidden("Telegram");
      }

      if (isApprover) {
        await assertTelegramBotCanPostToChat({
          botToken,
          chatId: delivery.chatId,
          fetchImpl: options.fetchImpl,
        });
      }
    }

    return;
  }

  if (delivery.channel === "whatsapp") {
    const config = await loadWhatsAppConfigFile(owner);

    if (!config?.phoneNumber.trim()) {
      throw new Error(
        "WhatsApp is not configured. Set up Integrations → WhatsApp first."
      );
    }

    if (!config.pairedJid) {
      throw new Error(
        "WhatsApp is not paired. Link your account in Integrations → WhatsApp first."
      );
    }

    return;
  }

  if (delivery.channel === "discord") {
    const config = await loadDiscordConfigFile(owner);
    const botToken = config?.botToken.trim();

    if (!(config && botToken)) {
      throw new Error(
        "Discord is not configured. Set up Integrations → Discord first."
      );
    }

    if (delivery.channelId === undefined) {
      if (config.pairedUserIds.length === 0) {
        throw new Error(
          "Discord is not paired. Link your account in Integrations → Discord first."
        );
      }

      return;
    }

    // Discord keeps no per-channel allowlist, so any caller-chosen channel is
    // an override: admins only, and only once the bot can post there.
    if (!mayOverrideDestination) {
      throw automationDeliveryDestinationForbidden("Discord");
    }

    if (isApprover) {
      await assertDiscordBotCanPostToChannel({
        botToken,
        channelId: delivery.channelId,
        fetchImpl: options.fetchImpl,
      });
    }

    return;
  }

  const emailConfigured = options.isEmailConfigured
    ? await options.isEmailConfigured()
    : isEmailConfigComplete(await loadEmailConfig());

  if (!emailConfigured) {
    throw new Error("Email is not configured. Set up mailbox settings first.");
  }

  const to = delivery.to?.trim();

  if (!to) {
    throw new Error("delivery.to is required when delivery.channel is email.");
  }

  if (!EMAIL_PATTERN.test(to)) {
    throw new Error("delivery.to must be a valid email address.");
  }
}
