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

  test("uses default timezone when schedule timezone is null", async () => {
    const delegate = createDelegate({
      getDefaultTimezone: async () => "Asia/Jakarta",
      listScheduledAutomations: async () => [
        schedule({ id: "a1", timezone: null }),
      ],
    });

    const scheduler = new AutomationScheduler(delegate);
    await scheduler.start();

    expect(scheduler.getStatus().scheduledJobs).toBe(1);
    scheduler.stop();
  });

  test("run delegate failures are logged but do not stop the scheduler", async () => {
    const delegate = createDelegate({
      listScheduledAutomations: async () => [
        schedule({ cron: "* * * * *", id: "a1" }),
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
        schedule({ cron: undefined, id: "a1", runAt: at }),
      ],
    });

    const scheduler = new AutomationScheduler(delegate);
    await scheduler.start();

    expect(scheduler.getStatus()).toEqual({ running: true, scheduledJobs: 1 });
    scheduler.stop();
  });
});
