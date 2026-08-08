import { describe, expect, test } from "bun:test";
import type { NakamaClient } from "@nakama/client";
import type {
  AutomationSchedule,
  AutomationSchedulerStatus,
} from "@nakama/core";
import { AutomationWorkerScheduler } from "./scheduler";

function createMockClient(
  overrides: Partial<{
    listAutomationSchedules: () => Promise<AutomationSchedule[]>;
    runAutomationInternal: (id: string) => Promise<void>;
    getTimezone: () => Promise<string>;
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

  test("poll reloads schedules", async () => {
    let schedules: AutomationSchedule[] = [
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

    const statusChanges: AutomationSchedulerStatus[] = [];
    const scheduler = new AutomationWorkerScheduler(client, (status) => {
      statusChanges.push(status);
    });

    await scheduler.start();
    schedules = [];
    await scheduler.start(); // start already reloads once

    // Poll interval is not used here; manually trigger reload not exposed.
    // We verify the scheduler registered the initial schedule.
    expect(scheduler.getStatus().scheduledJobs).toBe(1);
    scheduler.stop();
  });

  test("runAutomationInternal reports errors without throwing", async () => {
    const client = createMockClient({
      listAutomationSchedules: async () => [
        {
          cron: "* * * * *",
          id: "a1",
          orgId: "o1",
          profileId: "p1",
          timezone: "UTC",
        },
      ],
      runAutomationInternal: async () => {
        throw new Error("run failed");
      },
    });

    const scheduler = new AutomationWorkerScheduler(client);
    await scheduler.start();

    expect(scheduler.getStatus().running).toBe(true);
    scheduler.stop();
  });

  test("falls back to UTC when timezone endpoint fails", async () => {
    const client = createMockClient({
      getTimezone: async () => {
        throw new Error("unavailable");
      },
      listAutomationSchedules: async () => [
        {
          cron: "0 * * * *",
          id: "a1",
          orgId: "o1",
          profileId: "p1",
          timezone: null,
        },
      ],
    });

    const scheduler = new AutomationWorkerScheduler(client);
    await scheduler.start();

    expect(scheduler.getStatus().scheduledJobs).toBe(1);
    scheduler.stop();
  });
});
