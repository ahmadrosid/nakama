import { describe, expect, test } from "bun:test";
import {
  maskWebhookApiKey,
  parseTelegramTopicLink,
} from "./notification-destinations";

describe("buildNotificationWebhookUrl", () => {});

test("preserves Telegram topic-link parsing", () => {
  expect(parseTelegramTopicLink("https://t.me/c/3734526664/167")).toEqual({
    chatId: -1_003_734_526_664,
    topicId: 167,
  });
  expect(parseTelegramTopicLink("https://discord.com/channels/1/2")).toBeNull();
});

describe("maskWebhookApiKey", () => {
  test("masks long keys and keeps a short suffix", () => {
    expect(maskWebhookApiKey("nk_live_abcdefghij")).toBe("••••ghij");
  });

  test("fully masks short keys", () => {
    expect(maskWebhookApiKey("abc")).toBe("••••");
  });
});
