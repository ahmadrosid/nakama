import { describe, expect, test } from "bun:test";
import {
  isValidCronExpression,
  isWorkerSchedulable,
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
      })
    ).not.toThrow();
  });

  test("rejects invalid cron", () => {
    expect(() =>
      validateAutomationInput({
        name: "Daily digest",
        prompt: "Summarize news",
        trigger: { cron: "every morning", type: "schedule" },
      })
    ).toThrow(/Invalid cron/);
  });

  test("accepts runAt automations", () => {
    expect(() =>
      validateAutomationInput({
        name: "Reminder",
        prompt: "Send reminder email",
        trigger: { at: "2026-06-27T13:00:00.000Z", type: "runAt" },
      })
    ).not.toThrow();
  });

  test("rejects invalid runAt", () => {
    expect(() =>
      validateAutomationInput({
        name: "Reminder",
        prompt: "Send reminder email",
        trigger: { at: "not-a-date", type: "runAt" },
      })
    ).toThrow(/Invalid runAt/);
  });

  test("rejects empty prompt", () => {
    expect(() =>
      validateAutomationInput({
        name: "Daily digest",
        prompt: "   ",
        trigger: { type: "manual" },
      })
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
    expect(() => validateTimezone("Not/A_Timezone")).toThrow(
      /Invalid timezone/
    );
  });
});

describe("resolveScheduleTimezone", () => {
  test("fills missing timezone from user preference", () => {
    expect(
      resolveScheduleTimezone(
        { cron: "0 8 * * *", type: "schedule" },
        "Asia/Jakarta"
      )
    ).toEqual({
      cron: "0 8 * * *",
      timezone: "Asia/Jakarta",
      type: "schedule",
    });
  });

  test("fills runAt timezone from user preference", () => {
    expect(
      resolveScheduleTimezone(
        { at: "2026-06-27T13:00:00.000Z", type: "runAt" },
        "Asia/Jakarta"
      )
    ).toEqual({
      at: "2026-06-27T13:00:00.000Z",
      timezone: "Asia/Jakarta",
      type: "runAt",
    });
  });
});

describe("isWorkerSchedulable", () => {
  test("includes future runAt automations", () => {
    const at = new Date(Date.now() + 60_000).toISOString();
    expect(
      isWorkerSchedulable({
        enabled: true,
        trigger: { at, type: "runAt" },
      })
    ).toBe(true);
  });

  test("excludes past runAt automations", () => {
    expect(
      isWorkerSchedulable({
        enabled: true,
        trigger: { at: "2020-01-01T00:00:00.000Z", type: "runAt" },
      })
    ).toBe(false);
  });
});
