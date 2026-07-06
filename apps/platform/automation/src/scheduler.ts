import type { AutomationSchedule } from "@nakama/core/contract";
import {
  AutomationScheduler,
  type AutomationSchedulerDelegate,
  type AutomationSchedulerStatus,
} from "@nakama/core/automation-scheduler";
import type { NakamaClient } from "@nakama/client";

export interface AutomationWorkerSchedulerDelegate extends AutomationSchedulerDelegate {}

export class AutomationWorkerScheduler {
  private readonly scheduler: AutomationScheduler;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly client: NakamaClient,
    private readonly onStatusChange?: (status: AutomationSchedulerStatus) => void,
  ) {
    this.scheduler = new AutomationScheduler({
      listScheduledAutomations: () => this.fetchSchedules(),
      runAutomation: (id) => this.runAutomation(id),
      getDefaultTimezone: () => this.fetchDefaultTimezone(),
    });
  }

  async start(): Promise<void> {
    await this.scheduler.start();
    this.notifyStatus();
  }

  stop(): void {
    this.stopPolling();
    this.scheduler.stop();
    this.notifyStatus();
  }

  beginPolling(intervalMs: number): void {
    this.stopPolling();

    this.pollTimer = setInterval(async () => {
      try {
        await this.scheduler.reload();
        this.notifyStatus();
      } catch (error) {
        console.error("Failed to reload automation schedules:", error);
      }
    }, intervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchSchedules(): Promise<AutomationSchedule[]> {
    return this.client.listAutomationSchedules();
  }

  private async runAutomation(automationId: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
    try {
      await this.client.runAutomationInternal(automationId);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }

  private async fetchDefaultTimezone(): Promise<string> {
    try {
      return await this.client.getTimezone();
    } catch {
      return "UTC";
    }
  }

  getStatus(): AutomationSchedulerStatus {
    return this.scheduler.getStatus();
  }

  private notifyStatus(): void {
    this.onStatusChange?.(this.scheduler.getStatus());
  }
}
