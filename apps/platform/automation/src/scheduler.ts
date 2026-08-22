import type { NakamaClient } from "@nakama/client";
import {
  AutomationScheduler,
  type AutomationSchedulerDelegate,
  type AutomationSchedulerStatus,
} from "@nakama/core/automation-scheduler";
import type { AutomationSchedule } from "@nakama/core/contract";
import { tickSkillCurator } from "./curator-tick";

export interface AutomationWorkerSchedulerDelegate
  extends AutomationSchedulerDelegate {}

export class AutomationWorkerScheduler {
  private readonly scheduler: AutomationScheduler;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly client: NakamaClient,
    private readonly onStatusChange?: (
      status: AutomationSchedulerStatus
    ) => void
  ) {
    this.scheduler = new AutomationScheduler({
      getDefaultTimezone: () => this.fetchDefaultTimezone(),
      listScheduledAutomations: () => this.fetchSchedules(),
      runAutomation: (id, orgId) => this.runAutomation(id, orgId),
    });
  }

  async start(): Promise<void> {
    await this.scheduler.start();
    await this.tickCurator();
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
        await this.tickCurator();
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

  private async tickCurator(): Promise<void> {
    try {
      await tickSkillCurator(this.client);
    } catch (error) {
      console.error("Failed to tick skill curator:", error);
    }
  }

  private async fetchSchedules(): Promise<AutomationSchedule[]> {
    return this.client.listAutomationSchedules();
  }

  private async runAutomation(
    automationId: string,
    orgId: string
  ): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
    try {
      await this.client.runAutomationInternal(automationId, orgId);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: message, ok: false };
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
