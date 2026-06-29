import { isEmailConfigComplete, loadEmailConfig } from "./email-config";
import { loadTelegramConfigFile } from "./telegram-config";
import { loadWhatsAppConfigFile } from "./whatsapp-config";
import type { AutomationDelivery, AutomationDeliveryNotifyOn, AutomationRunStatus } from "./contract";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAutomationDelivery(value: unknown): AutomationDelivery | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    throw new Error("delivery must be an object.");
  }

  const record = value as Record<string, unknown>;
  const channel = record.channel;

  if (channel !== "telegram" && channel !== "whatsapp" && channel !== "email") {
    throw new Error('delivery.channel must be "telegram", "whatsapp", or "email".');
  }

  const delivery: AutomationDelivery = { channel };

  if (record.to !== undefined) {
    if (typeof record.to !== "string" || !record.to.trim()) {
      throw new Error("delivery.to must be a non-empty string.");
    }

    delivery.to = record.to.trim();
  }

  if (record.chatId !== undefined) {
    if (typeof record.chatId !== "number" || !Number.isInteger(record.chatId) || record.chatId <= 0) {
      throw new Error("delivery.chatId must be a positive integer.");
    }

    delivery.chatId = record.chatId;
  }

  if (record.notifyOn !== undefined) {
    if (record.notifyOn !== "success" && record.notifyOn !== "failure" && record.notifyOn !== "both") {
      throw new Error('delivery.notifyOn must be "success", "failure", or "both".');
    }

    delivery.notifyOn = record.notifyOn;
  }

  return delivery;
}

export function resolveDeliveryNotifyOn(
  delivery: AutomationDelivery,
): AutomationDeliveryNotifyOn {
  return delivery.notifyOn ?? "success";
}

export function shouldDeliverForRun(
  delivery: AutomationDelivery,
  status: AutomationRunStatus,
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

export async function validateAutomationDelivery(
  delivery: AutomationDelivery | undefined,
): Promise<void> {
  if (!delivery) {
    return;
  }

  if (delivery.channel === "telegram") {
    const config = await loadTelegramConfigFile();

    if (!config?.botToken.trim()) {
      throw new Error("Telegram is not configured. Set up Integrations → Telegram first.");
    }

    if (config.pairedUserIds.length === 0 && delivery.chatId === undefined) {
      throw new Error("Telegram is not paired. Link your account in Integrations → Telegram first.");
    }

    return;
  }

  if (delivery.channel === "whatsapp") {
    const config = await loadWhatsAppConfigFile();

    if (!config?.phoneNumber.trim()) {
      throw new Error("WhatsApp is not configured. Set up Integrations → WhatsApp first.");
    }

    if (!config.pairedJid) {
      throw new Error("WhatsApp is not paired. Link your account in Integrations → WhatsApp first.");
    }

    return;
  }

  const emailConfig = await loadEmailConfig();

  if (!isEmailConfigComplete(emailConfig)) {
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
