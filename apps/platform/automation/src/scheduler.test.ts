import { describe, expect, test } from "bun:test";
import type { NakamaClient } from "@nakama/client";
import type { AutomationSchedule } from "@nakama/core";
import { AutomationWorkerScheduler } from "./scheduler";

function createMockClient(
  overrides: Partial<{
    listAutomationSchedules: () => Promise<AutomationSchedule[]>;
    runAutomationInternal: (id: string, orgId: string) => Promise<void>;
    getAutomationWorkerSettings: () => Promise<{ pollIntervalMinutes: number }>;
    getTimezone: () => Promise<string>;
    listSkillCuratorOrgs: () => Promise<{ orgs: [] }>;
  }> = {}
): NakamaClient {
  return {
    getTimezone: async () => "UTC",
    listAutomationSchedules: async () => [],
    listSkillCuratorOrgs: async () => ({ orgs: [] }),
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

  test("reschedules polling when the workspace-global interval changes", async () => {
    const callbacks: Array<() => Promise<void>> = [];
    const intervals: number[] = [];
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = ((
      callback: () => Promise<void>,
      interval: number
    ) => {
      callbacks.push(callback);
      intervals.push(interval);
      return 1 as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearInterval = (() => undefined) as typeof clearInterval;

    try {
      const scheduler = new AutomationWorkerScheduler(
        createMockClient({
          getAutomationWorkerSettings: async () => ({
            pollIntervalMinutes: 10,
          }),
        })
      );
      scheduler.beginPolling(5 * 60 * 1000);
      await callbacks[0]!();

      expect(intervals).toEqual([5 * 60 * 1000, 10 * 60 * 1000]);
      scheduler.stop();
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("passes the automation orgId to the internal run endpoint", async () => {
    const calls: Array<[string, string]> = [];
    const client = createMockClient({
      listAutomationSchedules: async () => [
        {
          id: "a1",
          orgId: "o1",
          profileId: "p1",
          runAt: new Date(Date.now() + 50).toISOString(),
          timezone: "UTC",
        },
      ],
      runAutomationInternal: async (id: string, orgId: string) => {
        calls.push([id, orgId]);
      },
    });

    const scheduler = new AutomationWorkerScheduler(client);
    await scheduler.start();
    await Bun.sleep(150);
    scheduler.stop();

    expect(calls).toEqual([["a1", "o1"]]);
  });
});
