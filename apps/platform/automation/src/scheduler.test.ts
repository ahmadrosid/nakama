import { describe, expect, spyOn, test } from "bun:test";
import { NakamaClient } from "@nakama/client";
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
  const mockClient = {
    getTimezone: async () => "UTC",
    listAutomationSchedules: async () => [],
    listSkillCuratorOrgs: async () => ({ orgs: [] }),
    runAutomationInternal: async () => {},
    ...overrides,
  };

  // SAFETY: The scheduler calls only the methods supplied by this mock.
  return mockClient as NakamaClient;
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

  test("logs a failed Curator request and runs the next due organization", async () => {
    const curatorPath = "/v1/internal/curator/orgs";
    const runRequests: Array<{ body: unknown; path: string }> = [];

    const client = new NakamaClient({
      baseUrl: "http://nakama.test",
      async fetch(input, init) {
        const request = new Request(input, init);
        const { pathname } = new URL(request.url);

        if (pathname === "/v1/settings/timezone") {
          return Response.json({ timezone: "UTC" });
        }

        if (pathname === "/v1/internal/automations/schedules") {
          return Response.json([]);
        }

        if (pathname === curatorPath) {
          return Response.json({
            orgs: [
              {
                id: "archived-org",
                skillsCuratorEnabled: true,
                skillsCuratorLastRunAt: null,
              },
              {
                id: "recent-org",
                skillsCuratorEnabled: true,
                skillsCuratorLastRunAt: new Date().toISOString(),
              },
              {
                id: "due-org",
                skillsCuratorEnabled: true,
                skillsCuratorLastRunAt: "2000-01-01T00:00:00.000Z",
              },
            ],
          });
        }

        expect(request.method).toBe("POST");
        const body: unknown = await request.json();
        runRequests.push({ body, path: pathname });

        if (pathname === `${curatorPath}/archived-org/run`) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }

        return Response.json({ result: { status: "completed" } });
      },
    });

    const scheduler = new AutomationWorkerScheduler(client);
    const log = spyOn(console, "error").mockImplementation(() => {});

    try {
      await scheduler.start();

      expect(runRequests).toEqual([
        { body: { trigger: "seed" }, path: `${curatorPath}/archived-org/run` },
        { body: { trigger: "schedule" }, path: `${curatorPath}/due-org/run` },
      ]);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("archived-org"),
        expect.objectContaining({ status: 404 })
      );
    } finally {
      scheduler.stop();
      log.mockRestore();
    }
  });

  test("reschedules polling when the workspace-global interval changes", async () => {
    const callbacks: Array<() => Promise<void>> = [];
    const intervals: number[] = [];
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    // SAFETY: The mock uses a numeric sentinel only as an opaque timer handle.
    globalThis.setInterval = ((
      callback: () => Promise<void>,
      interval: number
    ) => {
      callbacks.push(callback);
      intervals.push(interval);

      // SAFETY: The scheduler stores and clears this opaque mocked timer handle.
      return 1 as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    // SAFETY: The mock accepts and ignores the opaque timer handle.
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
