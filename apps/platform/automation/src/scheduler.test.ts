import { describe, expect, test } from "bun:test";
import type { NakamaClient } from "@nakama/client";
import type { AutomationSchedule } from "@nakama/core";
import { AutomationWorkerScheduler } from "./scheduler";

function createMockClient(
  overrides: Partial<{
    listAutomationSchedules: () => Promise<AutomationSchedule[]>;
    runAutomationInternal: (id: string) => Promise<void>;
  }> = {}
): NakamaClient {
  return {
    getTimezone: async () => "UTC",
    listAutomationSchedules: async () => [],
    runAutomationInternal: async () => {},
    ...overrides,
  } as unknown as NakamaClient;
}

describe("AutomationWorkerScheduler", () => {
  test("starts and loads schedules from client", async () => {
    const schedules: AutomationSchedule[] = [
      {
        cron: "0 * * * *",
        id: "a1",
        orgId: "o1",
        profileId: "p1",
        timezone: "UTC",
      },
    ];
    const client = createMockClient({
      listAutomationSchedules: async () => schedules,
    });

    const scheduler = new AutomationWorkerScheduler(client);
    await scheduler.start();

    expect(scheduler.getStatus()).toEqual({ running: true, scheduledJobs: 1 });
    scheduler.stop();
  });
});
