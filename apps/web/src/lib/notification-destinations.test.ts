import { describe, expect, test } from "bun:test";
import {
  buildNotificationWebhookUrl,
  formatTelegramDestinationLabel,
  maskWebhookApiKey,
} from "./notification-destinations";

describe("buildNotificationWebhookUrl", () => {
  test("joins origin and webhook path", () => {
    expect(
      buildNotificationWebhookUrl("http://localhost:4310/", "/v1/notify/dest_1")
    ).toBe("http://localhost:4310/v1/notify/dest_1");
  });
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
