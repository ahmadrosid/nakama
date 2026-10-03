import { describe, expect, test } from "bun:test";
import {
  normalizeCreateNotificationDestinationRequest,
  normalizeNotificationWebhookRequest,
  normalizeUpdateNotificationDestinationRequest,
} from "./notification-destinations";

describe("normalizeNotificationWebhookRequest", () => {
  test("rejects empty body", () => {
    expect(() => normalizeNotificationWebhookRequest({ body: "   " })).toThrow(
      "body must be a non-empty string."
    );
  });
});

describe("normalizeCreateNotificationDestinationRequest", () => {
  test("rejects invalid telegram config", () => {
    expect(() =>
      normalizeCreateNotificationDestinationRequest({
        channel: "telegram",
        name: "Payments",
        telegram: { chatId: 0 },
      })
    ).toThrow("telegram.chatId must be a non-zero integer.");
  });
});

describe("normalizeUpdateNotificationDestinationRequest", () => {
  test("normalizes nullable topic id", () => {
    expect(
      normalizeUpdateNotificationDestinationRequest({
        name: "Ops",
        telegram: { chatId: 123, profileId: "agent_1" },
      })
    ).toEqual({
      channel: "telegram",
      name: "Ops",
      telegram: { chatId: 123, profileId: "agent_1", topicId: null },
    });
  });
});

test("normalizes all channels without converting Discord IDs to numbers", () => {
  for (const request of [
    {
      channel: "telegram",
      name: "Ops",
      telegram: { chatId: 123, profileId: "agent_1", topicId: null },
    },
    {
      channel: "discord",
      discord: { channelId: "12345678901234567890", profileId: "agent_1" },
      name: "Ops",
    },
    { channel: "whatsapp", name: "Ops", whatsapp: { profileId: "agent_1" } },
  ] as const) {
    expect(normalizeCreateNotificationDestinationRequest(request)).toEqual(
      request
    );
    expect(
      normalizeUpdateNotificationDestinationRequest(request, request.channel)
    ).toEqual(request);
  }
});

test("rejects invalid Discord IDs and channel/config mismatches", () => {
  for (const channelId of [
    Number("123456789012345678"),
    "",
    "123",
    "123456789012345678901",
    "12345678901234567/",
    "../users/@me",
  ]) {
    expect(() =>
      normalizeCreateNotificationDestinationRequest({
        channel: "discord",
        discord: { channelId, profileId: "agent_1" },
        name: "Ops",
      })
    ).toThrow();
  }
  expect(() =>
    normalizeCreateNotificationDestinationRequest({
      channel: "whatsapp",
      name: "Ops",
      telegram: { chatId: 1, profileId: "agent_1" },
      whatsapp: { profileId: "agent_1" },
    })
  ).toThrow();
  expect(() =>
    normalizeUpdateNotificationDestinationRequest(
      { channel: "whatsapp", name: "Ops", whatsapp: { profileId: "agent_1" } },
      "discord"
    )
  ).toThrow();
  expect(() =>
    normalizeCreateNotificationDestinationRequest({
      channel: "unknown",
      name: "Ops",
    })
  ).toThrow();
});

test("requires agents on every channel", () => {
  for (const request of [
    { channel: "telegram", name: "Ops", telegram: { chatId: 123 } },
    {
      channel: "discord",
      discord: { channelId: "123456789012345678" },
      name: "Ops",
    },
    { channel: "whatsapp", name: "Ops", whatsapp: { profileId: " " } },
  ]) {
    expect(() =>
      normalizeCreateNotificationDestinationRequest(request)
    ).toThrow();
  }
});
