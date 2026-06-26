import { Cron } from "croner";
import type { AutomationSchedule } from "./contract";
import { DEFAULT_TIMEZONE } from "./user-config";

// ponytail: setTimeout max delay is ~24.8 days; longer runAt jobs rely on worker poll reload.
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface AutomationSchedulerDelegate {
  listScheduledAutomations(): Promise<AutomationSchedule[]>;
  runAutomation(automationId: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }>;
  getDefaultTimezone(): Promise<string>;
}

export interface AutomationSchedulerStatus {
  running: boolean;
  scheduledJobs: number;
}

export class AutomationScheduler {
  private readonly jobs = new Map<string, Cron>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;

  constructor(private readonly delegate: AutomationSchedulerDelegate) {}

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
    this.timers.clear();
    this.started = false;
  }

  async reload(): Promise<void> {
    for (const job of this.jobs.values()) {
      job.stop();
    }

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.jobs.clear();
    this.timers.clear();

    const automations = await this.delegate.listScheduledAutomations();
    const defaultTimezone = await this.delegate.getDefaultTimezone();

    for (const automation of automations) {
      if (automation.runAt) {
        this.scheduleRunAt(automation);
        continue;
      }

      if (!automation.cron) {
        continue;
      }

      const timezone = automation.timezone ?? defaultTimezone ?? DEFAULT_TIMEZONE;
      const job = new Cron(
        automation.cron,
        {
          timezone,
          name: automation.id,
        },
        () => {
          void this.delegate.runAutomation(automation.id).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Automation ${automation.id} run failed:`, message);
          });
        },
      );

      this.jobs.set(automation.id, job);
    }
  }

  private scheduleRunAt(automation: AutomationSchedule): void {
    const at = Date.parse(automation.runAt ?? "");
    if (!Number.isFinite(at)) {
      return;
    }

    const delay = at - Date.now();
    if (delay <= 0 || delay > MAX_TIMEOUT_MS) {
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(automation.id);
      void this.delegate.runAutomation(automation.id).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Automation ${automation.id} run failed:`, message);
      });
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
