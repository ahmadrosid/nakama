import { describe, expect, test } from "bun:test";
import {
  type AutomationSchedule,
  AutomationScheduler,
  type AutomationSchedulerDelegate,
} from "./automation-scheduler";

function createDelegate(
  overrides: Partial<AutomationSchedulerDelegate> = {}
): AutomationSchedulerDelegate {
  return {
    getDefaultTimezone: async () => "UTC",
    listScheduledAutomations: async () => [],
    runAutomation: async () => ({ ok: true }),
    ...overrides,
  };
}

function schedule(
  automation: Partial<AutomationSchedule> = {}
): AutomationSchedule {
  return {
    cron: "0 * * * *",
    id: "automation_1",
    orgId: "org_1",
    profileId: "profile_1",
    timezone: "UTC",
    ...automation,
  };
}

describe("AutomationScheduler", () => {
  test("start loads schedules and registers cron jobs", async () => {
    const runs: string[] = [];
    const delegate = createDelegate({
      listScheduledAutomations: async () => [
        schedule({ cron: "* * * * *", id: "a1" }),
      ],
      runAutomation: async (id) => {
        runs.push(id);
        return { ok: true };
      },
    });

    const scheduler = new AutomationScheduler(delegate);
    await scheduler.start();

    expect(scheduler.getStatus()).toEqual({ running: true, scheduledJobs: 1 });
    scheduler.stop();
  });

  test("reload stops old jobs and registers current schedules", async () => {
    let automations: AutomationSchedule[] = [schedule({ id: "a1" })];
    const delegate = createDelegate({
      listScheduledAutomations: async () => automations,
    });

    const scheduler = new AutomationScheduler(delegate);
    await scheduler.start();
    expect(scheduler.getStatus().scheduledJobs).toBe(1);

    automations = [];
    await scheduler.reload();
    expect(scheduler.getStatus().scheduledJobs).toBe(0);

    scheduler.stop();
  });

  test("stop clears jobs and marks scheduler as not running", async () => {
    const delegate = createDelegate({
      listScheduledAutomations: async () => [schedule()],
    });

    const scheduler = new AutomationScheduler(delegate);
    await scheduler.start();
    scheduler.stop();

    expect(scheduler.getStatus()).toEqual({ running: false, scheduledJobs: 0 });
  });

  test("registers runAt schedules as timers", async () => {
    const at = new Date(Date.now() + 60_000).toISOString();
    const delegate = createDelegate({
      listScheduledAutomations: async () => [
        schedule({ cron: undefined, id: "a1", runAt: at }),
      ],
    });

    const scheduler = new AutomationScheduler(delegate);
    await scheduler.start();

    expect(scheduler.getStatus()).toEqual({ running: true, scheduledJobs: 1 });
    scheduler.stop();
  });

  test("runs one-shots due during reload", async () => {
    let now = Date.parse("2026-09-25T12:00:00.000Z");
    const runAt = new Date(now + 10).toISOString();
    const runs: string[] = [];
    const delegate = createDelegate({
      getDefaultTimezone: async () => {
        now = Date.parse(runAt);
        return "UTC";
      },
      listScheduledAutomations: async () => [
        schedule({ cron: undefined, id: "a1", runAt }),
      ],
      runAutomation: async (id) => {
        runs.push(id);
        return { ok: true };
      },
    });

    const scheduler = new AutomationScheduler(delegate, () => now);
    await scheduler.start();
    await scheduler.reload();
    await Promise.resolve();

    expect(runs).toEqual(["a1"]);
    scheduler.stop();
  });

  test("run delegate receives the schedule's org id", async () => {
    const at = new Date(Date.now() + 20).toISOString();
    const runs: Array<{ id: string; orgId: string }> = [];
    const delegate = createDelegate({
      listScheduledAutomations: async () => [
        schedule({ cron: undefined, id: "a1", orgId: "org_1", runAt: at }),
      ],
      runAutomation: async (id, orgId) => {
        runs.push({ id, orgId });
        return { ok: true };
      },
    });

    const scheduler = new AutomationScheduler(delegate);
    await scheduler.start();

    const deadline = Date.now() + 2000;
    while (runs.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(runs).toEqual([{ id: "a1", orgId: "org_1" }]);
    scheduler.stop();
  });

  test("logs a run the delegate refuses", async () => {
    const at = new Date(Date.now() + 20).toISOString();
    const errors: string[] = [];
    const originalError = console.error;
    console.error = ((...args: unknown[]) => {
      errors.push(args.join(" "));
    }) as typeof console.error;

    try {
      const delegate = createDelegate({
        listScheduledAutomations: async () => [
          schedule({ cron: undefined, id: "a1", runAt: at }),
        ],
        runAutomation: async () => ({
          error: "Automation not found",
          ok: false,
        }),
      });

      const scheduler = new AutomationScheduler(delegate);
      await scheduler.start();

      const deadline = Date.now() + 2000;
      while (errors.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(errors).toEqual([
        "Automation a1 run not started: Automation not found",
      ]);
      scheduler.stop();
    } finally {
      console.error = originalError;
    }
  });
});
