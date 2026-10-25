import { expect, test } from "bun:test";
import type { AutomationRunRecord } from "@nakama/core/contract";
import {
  automationRunMessages,
  describeTrigger,
  previewAutomationSchedule,
  readSchedulePreset,
  schedulePresetTrigger,
} from "./automations-page.shared";

test("run conversations retain tools and text and only animate a running run", () => {
  const run: AutomationRunRecord = {
    automationId: "automation",
    completedAt: null,
    error: null,
    id: "run",
    output: null,
    progress: [
      { content: "Check files", role: "user" },
      {
        content: "",
        role: "assistant",
        toolCalls: [
          { arguments: { command: "pwd" }, id: "call", name: "bash" },
        ],
      },
      {
        content: "",
        name: "bash",
        role: "tool",
        toolCallId: "call",
        toolStartedAt: 1000,
      },
    ],
    startedAt: "2026-10-01T00:00:00Z",
    status: "running",
  };

  const live = automationRunMessages(run);
  expect(live.map((item) => item.role)).toEqual(["user", "tool"]);
  expect(live[1]).toMatchObject({
    toolInput: { command: "pwd" },
    toolStatus: "running",
  });
  run.progress!.push({ content: "Result", role: "assistant" });
  expect(automationRunMessages(run).at(-1)?.streaming).toBe(true);
  run.status = "completed";
  const done = automationRunMessages(run);
  expect(done[1]).toMatchObject({ id: live[1]!.id, toolStatus: "done" });
  expect(done.at(-1)).toMatchObject({ content: "Result", streaming: false });
  run.status = "failed";
  run.error = "Disconnected";
  expect(automationRunMessages(run).at(-1)).toMatchObject({
    content: run.error,
    failed: true,
  });
  run.progress = undefined;
  run.error = null;
  run.output = "Legacy output";
  expect(automationRunMessages(run)).toHaveLength(1);
  expect(automationRunMessages(run)[0]?.content).toBe(run.output);
  run.status = "running";
  run.output = null;
  expect(automationRunMessages(run)[0]?.streaming).toBe(true);
});

test("daily cron reads as plain words and other triggers stay readable", () => {
  expect(
    describeTrigger({
      cron: "0 7 * * *",
      timezone: "Asia/Jakarta",
      type: "schedule",
    })
  ).toEqual({ label: "Every day, 7:00 AM", note: "Asia/Jakarta" });
  expect(describeTrigger({ cron: "*/5 * * * *", type: "schedule" }).label).toBe(
    "Custom schedule"
  );
  expect(describeTrigger({ cron: "5 * * * *", type: "schedule" }).label).toBe(
    "Every hour at :05"
  );
  expect(
    describeTrigger({ cron: "30 */3 * * *", type: "schedule" }).label
  ).toBe("Every 3 hours at :30");
  expect(describeTrigger({ type: "manual" }).label).toBe("Manual only");
});

test("schedule presets recognize supported frequencies without changing custom schedules", () => {
  for (const [cron, frequency] of [
    ["15 * * * *", "hourly"],
    ["0 */2 * * *", "hourly"],
    ["0 */12 * * *", "hourly"],
    ["0 7 * * *", "daily"],
    ["30 12 * * 1-5", "weekdays"],
    ["0 18 * * 0", "weekly"],
    ["0 7 31 * *", "monthly"],
  ]) {
    expect(readSchedulePreset({ cron, type: "schedule" })?.frequency).toBe(
      frequency
    );
  }

  for (const cron of [
    "*/15 * * * *",
    "0 7 1 * 1",
    "0 * * * 1-5",
    "0 * 1 * *",
    "0 */5 * * *",
    "0 */2 * * 1",
    "0 25 * * *",
    "60 7 * * *",
  ]) {
    expect(readSchedulePreset({ cron, type: "schedule" })).toBeNull();
  }
});

test("switching to and from hourly keeps the minute and resets the hour", () => {
  const hourly = schedulePresetTrigger("hourly", {
    cron: "30 18 * * 1-5",
    type: "schedule",
  });

  expect(hourly).toEqual({ cron: "30 * * * *", type: "schedule" });
  expect(schedulePresetTrigger("weekly", hourly)).toEqual({
    cron: "30 7 * * 1",
    type: "schedule",
  });
  expect(
    schedulePresetTrigger("hourly", { cron: "0 */4 * * *", type: "schedule" })
  ).toEqual({ cron: "0 */4 * * *", type: "schedule" });
  expect(
    schedulePresetTrigger("daily", { cron: "0 */4 * * *", type: "schedule" })
  ).toEqual({ cron: "0 7 * * *", type: "schedule" });
  expect(schedulePresetTrigger("hourly", { type: "manual" })).toEqual({
    cron: "0 * * * *",
    type: "schedule",
  });
});

test("next-run preview uses the draft schedule and its time zone", () => {
  const now = new Date("2026-10-11T01:00:00Z");
  expect(
    previewAutomationSchedule(
      { cron: "0 7 * * *", type: "schedule" },
      "Asia/Jakarta",
      now
    )
  ).toBe("Tomorrow, 7:00 AM");
  expect(
    previewAutomationSchedule(
      { cron: "0 12 * * *", type: "schedule" },
      "Asia/Jakarta",
      now
    )
  ).toBe("Today, 12:00 PM");
  expect(
    previewAutomationSchedule(
      { cron: "0 7 * * 1", type: "schedule" },
      "Asia/Jakarta",
      now
    )
  ).toBe("Tomorrow, 7:00 AM");
  expect(
    previewAutomationSchedule(
      { cron: "0 7 1 * *", type: "schedule" },
      "Asia/Jakarta",
      now
    )
  ).toBe("Sun, Nov 1, 7:00 AM");
  expect(previewAutomationSchedule({ type: "manual" }, "UTC", now)).toBeNull();
  expect(
    previewAutomationSchedule({ cron: "invalid", type: "schedule" }, "UTC", now)
  ).toBeNull();
});

test("next-run preview handles daylight saving changes and short months", () => {
  expect(
    previewAutomationSchedule(
      { cron: "0 7 * * *", type: "schedule" },
      "America/New_York",
      new Date("2026-03-08T04:30:00Z")
    )
  ).toBe("Tomorrow, 7:00 AM");
  expect(
    previewAutomationSchedule(
      { cron: "0 7 31 * *", type: "schedule" },
      "UTC",
      new Date("2026-02-01T00:00:00Z")
    )
  ).toBe("Tue, Mar 31, 7:00 AM");
});
