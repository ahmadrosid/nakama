import { describe, expect, spyOn, test } from "bun:test";
import type { NakamaClient } from "@nakama/client";
import type { AutomationSchedule } from "@nakama/core";
import { AutomationWorkerScheduler } from "./scheduler";

const POLL_INTERVAL_MS = 1000;

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

  test("serializes complete poll cycles and resumes after failures", async () => {
    const releaseFirstReload = Promise.withResolvers<void>();
    const curatorStarted = Promise.withResolvers<void>();
    const failingCurator =
      Promise.withResolvers<
        Awaited<ReturnType<NakamaClient["listSkillCuratorOrgs"]>>
      >();
    const failingReload = Promise.withResolvers<AutomationSchedule[]>();
    let intervalCallback: (() => Promise<void>) | undefined;
    let curatorCalls = 0;
    let listCalls = 0;
    let statusChanges = 0;
    const client = createMockClient({
      listAutomationSchedules: async () => {
        listCalls += 1;
        if (listCalls === 1) {
          return [];
        }

        if (listCalls === 2) {
          await releaseFirstReload.promise;
          return [];
        }

        if (listCalls === 3) {
          return failingReload.promise;
        }

        return [];
      },
    });
    client.listSkillCuratorOrgs = async () => {
      curatorCalls += 1;
      if (curatorCalls === 2) {
        curatorStarted.resolve();
        return failingCurator.promise;
      }

      return { orgs: [] };
    };
    const scheduler = new AutomationWorkerScheduler(client, () => {
      statusChanges += 1;
    });
    const intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(
      (callback) => {
        intervalCallback = callback as () => Promise<void>;
        return {} as ReturnType<typeof setInterval>;
      }
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const pendingPolls: Promise<void>[] = [];

    try {
      await scheduler.start();
      scheduler.beginPolling(POLL_INTERVAL_MS);
      const poll = intervalCallback;
      if (!poll) {
        throw new Error("Polling callback was not registered.");
      }

      const firstPoll = poll();
      pendingPolls.push(firstPoll);
      expect(listCalls).toBe(2);

      const reloadOverlap = poll();
      pendingPolls.push(reloadOverlap);
      expect(listCalls).toBe(2);

      releaseFirstReload.resolve();
      await curatorStarted.promise;
      const curatorOverlap = poll();
      pendingPolls.push(curatorOverlap);
      expect(listCalls).toBe(2);

      failingCurator.reject(new Error("curator failed"));
      await Promise.all([firstPoll, reloadOverlap, curatorOverlap]);
      expect(statusChanges).toBe(2);

      const failedReloadPoll = poll();
      const failedReloadOverlap = poll();
      pendingPolls.push(failedReloadPoll, failedReloadOverlap);
      expect(listCalls).toBe(3);

      failingReload.reject(new Error("reload failed"));
      await Promise.all([failedReloadPoll, failedReloadOverlap]);

      const resumedPoll = poll();
      pendingPolls.push(resumedPoll);
      await resumedPoll;

      expect(listCalls).toBe(4);
      expect(statusChanges).toBe(3);
      expect(errorSpy).toHaveBeenCalledTimes(2);
    } finally {
      releaseFirstReload.resolve();
      failingCurator.resolve({ orgs: [] });
      failingReload.resolve([]);
      await Promise.all(
        pendingPolls.map((pendingPoll) => pendingPoll.catch(() => undefined))
      );
      scheduler.stop();
      errorSpy.mockRestore();
      intervalSpy.mockRestore();
    }
  });
});
