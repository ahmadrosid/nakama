import { describe, expect, test } from "bun:test";
import {
  normalizeAutomationDelivery,
  shouldDeliverForRun,
  validateAutomationDelivery,
} from "./automation-delivery";

describe("normalizeAutomationDelivery", () => {
  test("returns undefined for missing delivery", () => {
    expect(normalizeAutomationDelivery(undefined)).toBeUndefined();
    expect(normalizeAutomationDelivery(null)).toBeUndefined();
  });

  test("parses telegram delivery", () => {
    expect(normalizeAutomationDelivery({ channel: "telegram" })).toEqual({
      channel: "telegram",
    });
  });

  test("rejects invalid channel", () => {
    expect(() => normalizeAutomationDelivery({ channel: "sms" })).toThrow(
      'delivery.channel must be "telegram", "whatsapp", or "email".',
    );
  });
});

describe("shouldDeliverForRun", () => {
  test("defaults to success-only delivery", () => {
    expect(
      shouldDeliverForRun({ channel: "telegram" }, "completed"),
    ).toBe(true);
    expect(shouldDeliverForRun({ channel: "telegram" }, "failed")).toBe(false);
  });

  test("honors notifyOn both", () => {
    const delivery = { channel: "telegram" as const, notifyOn: "both" as const };
    expect(shouldDeliverForRun(delivery, "completed")).toBe(true);
    expect(shouldDeliverForRun(delivery, "failed")).toBe(true);
  });
});

describe("validateAutomationDelivery", () => {
  test("no-ops when delivery is omitted", async () => {
    await expect(validateAutomationDelivery(undefined)).resolves.toBeUndefined();
  });
});
