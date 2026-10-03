import { describe, expect, test } from "bun:test";
import {
  buildNotificationWebhookUrl,
  formatNotificationDestinationLabel,
  formatTelegramDestinationLabel,
  maskWebhookApiKey,
  parseTelegramTopicLink,
} from "./notification-destinations";

describe("buildNotificationWebhookUrl", () => {
  test("joins origin and webhook path", () => {
    expect(
      buildNotificationWebhookUrl("http://localhost:4310/", "/v1/notify/dest_1")
    ).toBe("http://localhost:4310/v1/notify/dest_1");
  });
});

test("labels every channel's target", () => {
  const common = {
    createdAt: "",
    id: "dest",
    name: "Ops",
    updatedAt: "",
    webhookPath: "/v1/notify/dest",
  };
  expect(
    formatNotificationDestinationLabel({
      ...common,
      channel: "telegram",
      telegram: { chatId: -100_123, topicId: 22 },
    })
  ).toBe("Telegram · Chat -100123 / Topic 22");
  expect(
    formatNotificationDestinationLabel({
      ...common,
      channel: "discord",
      discord: { channelId: "12345678901234567890", profileId: "agent" },
    })
  ).toBe("Discord · Channel 12345678901234567890");
  expect(
    formatNotificationDestinationLabel({
      ...common,
      channel: "whatsapp",
      whatsapp: { profileId: "agent" },
    })
  ).toBe("WhatsApp · Agent's paired contact");
});

test("preserves Telegram topic-link parsing", () => {
  expect(parseTelegramTopicLink("https://t.me/c/3734526664/167")).toEqual({
    chatId: -1_003_734_526_664,
    topicId: 167,
  });
  expect(parseTelegramTopicLink("https://discord.com/channels/1/2")).toBeNull();
});

describe("formatTelegramDestinationLabel", () => {
  test("formats chat-only destinations", () => {
    expect(formatTelegramDestinationLabel({ chatId: 1001 })).toBe("Chat 1001");
  });

  test("formats topic destinations", () => {
    expect(formatTelegramDestinationLabel({ chatId: 1001, topicId: 22 })).toBe(
      "Chat 1001 / Topic 22"
    );
  });
});

describe("maskWebhookApiKey", () => {
  test("masks long keys and keeps a short suffix", () => {
    expect(maskWebhookApiKey("nk_live_abcdefghij")).toBe("••••ghij");
  });

  test("fully masks short keys", () => {
    expect(maskWebhookApiKey("abc")).toBe("••••");
  });
});
