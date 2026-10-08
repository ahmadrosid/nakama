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

  test("a failed reload keeps the last good schedules, and the next good one still replaces them", async () => {
    let next: () => AutomationSchedule[] = () => [schedule({ id: "a1" })];

    const scheduler = new AutomationScheduler(
      createDelegate({ listScheduledAutomations: async () => next() })
    );

    try {
      await scheduler.start();
      // An unchanged list replaces each job with one for the same id.
      await scheduler.reload();
      expect(scheduler.getStatus().scheduledJobs).toBe(1);

      next = () => {
        throw new Error("temporary network failure");
      };

      await expect(scheduler.reload()).rejects.toThrow();
      expect(scheduler.getStatus().scheduledJobs).toBe(1);

      // One unreadable entry must not cost the others their jobs either.
      next = () => [
        schedule({ id: "a1" }),
        schedule({ cron: "nope", id: "a2" }),
      ];
      await expect(scheduler.reload()).rejects.toThrow("nope");
      expect(scheduler.getStatus().scheduledJobs).toBe(1);

      next = () => [];
      await scheduler.reload();
      expect(scheduler.getStatus().scheduledJobs).toBe(0);
    } finally {
      scheduler.stop();
    }
  });

  test("a cron job replaced on reload fires, and only once per tick", async () => {
    const firedAt: number[] = [];

    const scheduler = new AutomationScheduler(
      createDelegate({
        listScheduledAutomations: async () => [
          schedule({ cron: "* * * * * *", id: "every_second" }),
        ],
        runAutomation: async () => {
          firedAt.push(Date.now());

          return { ok: true };
        },
      })
    );

    try {
      await scheduler.start();
      await scheduler.reload();
      await Bun.sleep(1100);

      expect(firedAt.length).toBeGreaterThanOrEqual(1);
      // A job left running beside its replacement fires in the same tick.
      const gaps = firedAt.slice(1).map((at, index) => at - firedAt[index]);
      expect(gaps.every((gap) => gap > 500)).toBe(true);
    } finally {
      scheduler.stop();
    }
  });

  test("a one-shot registered before a failed reload still runs, once", async () => {
    const now = Date.parse("2026-10-04T00:00:00.000Z");
    const runs: string[] = [];
    let failing = false;

    const scheduler = new AutomationScheduler(
      createDelegate({
        listScheduledAutomations: async () => {
          if (failing) {
            throw new Error("temporary network failure");
          }

          return [
            schedule({
              cron: undefined,
              id: "once",
              runAt: new Date(now + 50).toISOString(),
            }),
          ];
        },
        runAutomation: async (id) => {
          runs.push(id);

          return { ok: true };
        },
      }),
      () => now
    );

    try {
      await scheduler.start();
      failing = true;
      await expect(scheduler.reload()).rejects.toThrow();
      await Bun.sleep(150);
      expect(runs).toEqual(["once"]);

      // The schedule is still listed after it ran. Recovery must not run it again.
      failing = false;
      await scheduler.reload();
      await Bun.sleep(150);
      expect(runs).toEqual(["once"]);
    } finally {
      scheduler.stop();
    }
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
    // SAFETY: console.error accepts variadic values and this spy preserves that call shape.
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
