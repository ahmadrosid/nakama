import { Cron } from "croner";
import type { StoredAutomation } from "@tinyclaw/core";
import { DEFAULT_TIMEZONE } from "@tinyclaw/core";
import type { AutomationRunner } from "./automation-runner";
import type { AutomationService } from "./automation-service";

export class AutomationScheduler {
  private readonly jobs = new Map<string, Cron>();
  private started = false;

  constructor(
    private readonly automationService: AutomationService,
    private readonly runner: AutomationRunner,
    private readonly getUserTimezone: () => Promise<string>,
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

    this.jobs.clear();
    this.started = false;
  }

  async reload(): Promise<void> {
    for (const job of this.jobs.values()) {
      job.stop();
    }

    this.jobs.clear();

    const automations = await this.automationService.list();
    const userTimezone = await this.getUserTimezone();

    for (const automation of automations) {
      if (automation.trigger.type !== "schedule" || !automation.enabled) {
        continue;
      }

      const timezone = automation.trigger.timezone ?? userTimezone ?? DEFAULT_TIMEZONE;
      const job = new Cron(
        automation.trigger.cron,
        {
          timezone,
          name: automation.id,
        },
        () => {
          void this.runner.run(automation.id);
        },
      );

      this.jobs.set(automation.id, job);
    }
  }

  getNextRunAt(automation: StoredAutomation, userTimezone: string): string | null {
    return this.automationService.computeNextRunAt(automation.trigger, userTimezone);
  }

  getStatus(): { running: boolean; scheduledJobs: number } {
    return {
      running: this.started,
      scheduledJobs: this.jobs.size,
    };
  }
}
