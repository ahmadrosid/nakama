import { Cron } from "croner";
import { AUTOMATION_RUN_AT_GRACE_MS } from "./automation-validate";
import type { AutomationSchedule } from "./contract";
import { DEFAULT_TIMEZONE } from "./user-config";

// ponytail: setTimeout max delay is ~24.8 days; longer runAt jobs rely on worker poll reload.
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface AutomationSchedulerDelegate {
  getDefaultTimezone(): Promise<string>;
  listScheduledAutomations(): Promise<AutomationSchedule[]>;
  runAutomation(
    automationId: string,
    orgId: string
  ): Promise<{ ok: boolean; skipped?: boolean; error?: string }>;
}

export interface AutomationSchedulerStatus {
  running: boolean;
  scheduledJobs: number;
}

export class AutomationScheduler {
  private readonly jobs = new Map<string, Cron>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly dispatchedRunAt = new Set<string>();
  private started = false;

  constructor(
    private readonly delegate: AutomationSchedulerDelegate,
    private readonly now: () => number = Date.now
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    await this.reload();
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.jobs.clear();
    this.dispatchedRunAt.clear();
    this.timers.clear();
    this.started = false;
  }

  async reload(): Promise<void> {
    // Load and build before clearing anything. A failed list call or one bad
    // cron expression must leave the last good schedules running.
    const automations = await this.delegate.listScheduledAutomations();
    const defaultTimezone = await this.delegate.getDefaultTimezone();
    const jobs = new Map<string, Cron>();

    for (const automation of automations) {
      if (automation.runAt || !automation.cron) {
        continue;
      }

      const timezone =
        automation.timezone ?? defaultTimezone ?? DEFAULT_TIMEZONE;

      jobs.set(
        automation.id,
        // Paused, so a throw on a later entry leaves nothing ticking. No name:
        // croner refuses a name that is still running, and the old job is.
        new Cron(automation.cron, { paused: true, timezone }, () =>
          this.dispatch(automation)
        )
      );
    }

    for (const job of this.jobs.values()) {
      job.stop();
    }

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.jobs.clear();
    this.timers.clear();

    for (const [id, job] of jobs) {
      job.resume();
      this.jobs.set(id, job);
    }

    const now = this.now();

    for (const automation of automations) {
      if (automation.runAt) {
        this.scheduleRunAt(automation, now);
      }
    }
  }

  private dispatch(automation: AutomationSchedule): void {
    void this.delegate
      .runAutomation(automation.id, automation.orgId)
      .then((result) => {
        if (!result.ok) {
          console.error(
            `Automation ${automation.id} run not started: ${result.error ?? "unknown error"}`
          );
        }
      })
      .catch(<Failure>(cause: Failure) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error(`Automation ${automation.id} run failed:`, message);
      });
  }

  private scheduleRunAt(automation: AutomationSchedule, now: number): void {
    const at = Date.parse(automation.runAt ?? "");

    if (!Number.isFinite(at)) {
      return;
    }

    const dispatchKey = `${automation.id}:${automation.runAt}`;

    if (this.dispatchedRunAt.has(dispatchKey)) {
      return;
    }

    const delay = at - now;

    if (delay > MAX_TIMEOUT_MS) {
      return;
    }

    if (delay <= 0) {
      if (delay < -AUTOMATION_RUN_AT_GRACE_MS) {
        return;
      }

      this.dispatchedRunAt.add(dispatchKey);
      this.dispatch(automation);

      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(automation.id);
      this.dispatchedRunAt.add(dispatchKey);
      this.dispatch(automation);
    }, delay);

    this.timers.set(automation.id, timer);
  }

  getStatus(): AutomationSchedulerStatus {
    return {
      running: this.started,
      scheduledJobs: this.jobs.size + this.timers.size,
    };
  }
}
