import { Cron } from "croner";
import type { AutomationSchedule } from "./contract";
import { DEFAULT_TIMEZONE } from "./user-config";

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

    this.jobs.clear();
    this.started = false;
  }

  async reload(): Promise<void> {
    for (const job of this.jobs.values()) {
      job.stop();
    }

    this.jobs.clear();

    const automations = await this.delegate.listScheduledAutomations();
    const defaultTimezone = await this.delegate.getDefaultTimezone();

    for (const automation of automations) {
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

  getStatus(): AutomationSchedulerStatus {
    return {
      running: this.started,
      scheduledJobs: this.jobs.size,
    };
  }
}
