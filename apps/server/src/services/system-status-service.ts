import type { HealthResponse, SystemStatusResponse } from "@tinyclaw/core";
import { TINYCLAW_API_VERSION } from "@tinyclaw/core";
import type { AgentService } from "./agent-service";
import type { AutomationRunner } from "./automation-runner";
import type { AutomationScheduler } from "./automation-scheduler";

export class SystemStatusService {
  constructor(
    private readonly agent: AgentService,
    private readonly scheduler: AutomationScheduler,
    private readonly runner: AutomationRunner,
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
        activeRuns: this.runner.getActiveRunCount(),
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
