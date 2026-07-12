import { describe, expect, test } from "bun:test";
import {
  normalizeCreateNotificationDestinationRequest,
  normalizeNotificationWebhookRequest,
  normalizeUpdateNotificationDestinationRequest,
} from "./notification-destinations";

describe("normalizeNotificationWebhookRequest", () => {
  test("rejects empty body", () => {
    expect(() => normalizeNotificationWebhookRequest({ body: "   " })).toThrow(
      "body must be a non-empty string.",
    );
  });
});

describe("normalizeCreateNotificationDestinationRequest", () => {
  test("rejects invalid telegram config", () => {
    expect(
      () =>
        normalizeCreateNotificationDestinationRequest({
          name: "Payments",
          channel: "telegram",
          telegram: { chatId: 0 },
        }),
    ).toThrow("telegram.chatId must be a non-zero integer.");
  });
});

describe("normalizeUpdateNotificationDestinationRequest", () => {
  test("normalizes nullable topic id", () => {
    expect(
      normalizeUpdateNotificationDestinationRequest({
        name: "Ops",
        telegram: { chatId: 123 },
      }),
    ).toEqual({
      name: "Ops",
      telegram: { chatId: 123, topicId: null },
    });
  });
});
