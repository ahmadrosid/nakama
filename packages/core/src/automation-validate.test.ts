import { describe, expect, test } from "bun:test";
import {
  isValidCronExpression,
  resolveScheduleTimezone,
  validateAutomationInput,
  validateTimezone,
} from "./automation-validate";

describe("validateAutomationInput", () => {
  test("accepts manual automations with prompt", () => {
    expect(() =>
      validateAutomationInput({
        name: "Daily digest",
        prompt: "Summarize news",
        trigger: { type: "manual" },
      }),
    ).not.toThrow();
  });

  test("rejects invalid cron", () => {
    expect(() =>
      validateAutomationInput({
        name: "Daily digest",
        prompt: "Summarize news",
        trigger: { type: "schedule", cron: "every morning" },
      }),
    ).toThrow(/Invalid cron/);
  });

  test("rejects empty prompt", () => {
    expect(() =>
      validateAutomationInput({
        name: "Daily digest",
        prompt: "   ",
        trigger: { type: "manual" },
      }),
    ).toThrow(/prompt is required/);
  });
});

describe("isValidCronExpression", () => {
  test("accepts standard 5-field cron", () => {
    expect(isValidCronExpression("0 8 * * *")).toBe(true);
  });

  test("rejects non-cron strings", () => {
    expect(isValidCronExpression("0 8 * *")).toBe(false);
  });
});

describe("validateTimezone", () => {
  test("defaults to UTC", () => {
    expect(validateTimezone(undefined)).toBe("UTC");
  });

  test("accepts valid IANA timezone", () => {
    expect(validateTimezone("Asia/Jakarta")).toBe("Asia/Jakarta");
  });

  test("rejects invalid timezone", () => {
    expect(() => validateTimezone("Not/A_Timezone")).toThrow(/Invalid timezone/);
  });
});

describe("resolveScheduleTimezone", () => {
  test("fills missing timezone from user preference", () => {
    expect(
      resolveScheduleTimezone(
        { type: "schedule", cron: "0 8 * * *" },
        "Asia/Jakarta",
      ),
    ).toEqual({
      type: "schedule",
      cron: "0 8 * * *",
      timezone: "Asia/Jakarta",
    });
  });
});
