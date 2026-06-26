import { describe, expect, test } from "bun:test";
import {
  AutomationScheduler,
  type AutomationSchedule,
  type AutomationSchedulerDelegate,
} from "./automation-scheduler";

function createDelegate(
  overrides: Partial<AutomationSchedulerDelegate> = {},
): AutomationSchedulerDelegate {
  return {
    listScheduledAutomations: async () => [],
    runAutomation: async () => ({ ok: true }),
    getDefaultTimezone: async () => "UTC",
    ...overrides,
  };
}

function schedule(automation: Partial<AutomationSchedule> = {}): AutomationSchedule {
  return {
    id: "automation_1",
    cron: "0 * * * *",
    timezone: "UTC",
    orgId: "org_1",
    profileId: "profile_1",
    ...automation,
  };
}

describe("AutomationScheduler", () => {
  test("start loads schedules and registers cron jobs", async () => {
    const runs: string[] = [];
    const delegate = createDelegate({
      listScheduledAutomations: async () => [
        schedule({ id: "a1", cron: "* * * * *" }),
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

  test("uses default timezone when schedule timezone is null", async () => {
    const delegate = createDelegate({
      listScheduledAutomations: async () => [
        schedule({ id: "a1", timezone: null }),
      ],
      getDefaultTimezone: async () => "Asia/Jakarta",
    });

    const scheduler = new AutomationScheduler(delegate);
    await scheduler.start();

    expect(scheduler.getStatus().scheduledJobs).toBe(1);
    scheduler.stop();
  });

  test("run delegate failures are logged but do not stop the scheduler", async () => {
    const delegate = createDelegate({
      listScheduledAutomations: async () => [
        schedule({ id: "a1", cron: "* * * * *" }),
      ],
      runAutomation: async () => {
        throw new Error("boom");
      },
    });

    const scheduler = new AutomationScheduler(delegate);
    await scheduler.start();

    expect(scheduler.getStatus().running).toBe(true);
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
        schedule({ id: "a1", cron: undefined, runAt: at }),
      ],
    });

    const scheduler = new AutomationScheduler(delegate);
    await scheduler.start();

    expect(scheduler.getStatus()).toEqual({ running: true, scheduledJobs: 1 });
    scheduler.stop();
  });
});
