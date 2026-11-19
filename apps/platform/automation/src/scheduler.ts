import type { NakamaClient } from "@nakama/client";
import { log, resolveCuratorScheduleAction } from "@nakama/core";
import {
  AutomationScheduler,
  type AutomationSchedulerStatus,
} from "@nakama/core/automation-scheduler";
import type { AutomationSchedule } from "@nakama/core/contract";

const CURATOR_RUN_TIMEOUT_MS = 10 * 60 * 1000;

const CURATOR_RETRY_DELAY_MS = 60 * 60 * 1000;

const CURATOR_MAX_CONSECUTIVE_FAILURES = 3;

async function tickSkillCurator(
  client: Pick<
    NakamaClient,
    "listSkillCuratorOrgs" | "runSkillCuratorInternal"
  >,
  retryAt: Map<string, number>,
  now = new Date()
): Promise<void> {
  const { orgs } = await client.listSkillCuratorOrgs();
  const orgIds = new Set(orgs.map((org) => org.id));

  for (const orgId of retryAt.keys()) {
    if (!orgIds.has(orgId)) {
      retryAt.delete(orgId);
    }
  }

  let consecutiveFailures = 0;

  for (const org of orgs) {
    const action = resolveCuratorScheduleAction({
      enabled: org.skillsCuratorEnabled,
      lastRunAt: org.skillsCuratorLastRunAt,
      now,
    });

    if (action === "skip" || (retryAt.get(org.id) ?? 0) > now.getTime()) {
      continue;
    }

    try {
      await client.runSkillCuratorInternal(
        org.id,
        { trigger: action },
        AbortSignal.timeout(CURATOR_RUN_TIMEOUT_MS)
      );

      retryAt.delete(org.id);
      consecutiveFailures = 0;
    } catch (error) {
      retryAt.set(org.id, now.getTime() + CURATOR_RETRY_DELAY_MS);
      consecutiveFailures += 1;

      log("error", "curator.run_failed", {
        error: error instanceof Error ? error.message : String(error),
        orgId: org.id,
      });

      // A run of failures points at the server, not at one organization.
      if (consecutiveFailures >= CURATOR_MAX_CONSECUTIVE_FAILURES) {
        return;
      }
    }
  }
}

export class AutomationWorkerScheduler {
  private readonly scheduler: AutomationScheduler;
  private readonly curatorRetryAt = new Map<string, number>();
  private pollIntervalMs: number | null = null;
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
    this.pollIntervalMs = intervalMs;

    this.pollTimer = setInterval(async () => {
      if (this.pollInFlight) {
        return;
      }

      this.pollInFlight = true;

      try {
        const settings = await this.client
          .getAutomationWorkerSettings()
          .catch(() => null);

        const nextIntervalMs = settings
          ? settings.pollIntervalMinutes * 60 * 1000
          : (this.pollIntervalMs ?? intervalMs);

        if (nextIntervalMs !== this.pollIntervalMs) {
          this.beginPolling(nextIntervalMs);
        }

        await this.scheduler.reload();
        await this.tickCurator();
        this.notifyStatus();
      } catch (error) {
        console.error("Failed to reload automation schedules:", error);
      } finally {
        this.pollInFlight = false;
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
      await tickSkillCurator(this.client, this.curatorRetryAt);
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
