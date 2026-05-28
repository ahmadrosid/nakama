import type { HealthResponse, SystemStatusResponse } from "@tinyclaw/core";
import { TINYCLAW_API_VERSION } from "@tinyclaw/core";
import type { AgentService } from "./agent-service";
import type { AutomationRunner } from "./automation-runner";
import type { AutomationScheduler } from "./automation-scheduler";
import type { TaskRunner } from "./task-runner";

export class SystemStatusService {
  constructor(
    private readonly agent: AgentService,
    private readonly scheduler: AutomationScheduler,
    private readonly automationRunner: AutomationRunner,
    private readonly taskRunner: TaskRunner,
  ) {}

  getStatus(): SystemStatusResponse {
    const scheduler = this.scheduler.getStatus();
    const providerConfigured = this.agent.providerConfigured;

    return {
      server: this.getServerStatus(),
      automationWorker: {
        ok: scheduler.running,
        running: scheduler.running,
        scheduledJobs: scheduler.scheduledJobs,
        activeRuns: this.automationRunner.getActiveRunCount(),
        providerConfigured,
      },
      taskWorker: {
        ok: true,
        activeRuns: this.taskRunner.getActiveRunCount(),
        providerConfigured,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  private getServerStatus(): HealthResponse {
    return {
      ok: true,
      apiVersion: TINYCLAW_API_VERSION,
      providerConfigured: this.agent.providerConfigured,
    };
  }
}
