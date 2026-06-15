import type { HealthResponse, LlmUsageStatus, SystemStatusResponse, WorkerProcessInfo } from "@tinyclaw/core";
import { getTelegramWorkerStatus, getWhatsAppWorkerStatus, TINYCLAW_API_VERSION } from "@tinyclaw/core";
import type { AgentService } from "./agent-service";
import type { AutomationRunner } from "./automation-runner";
import type { AutomationScheduler } from "./automation-scheduler";
import type { McpService } from "./mcp-service";
import type { TaskRunner } from "./task-runner";
import type { WorkerManagerService } from "./worker-manager-service";

export class SystemStatusService {
  constructor(
    private readonly agent: AgentService,
    private readonly scheduler: AutomationScheduler,
    private readonly automationRunner: AutomationRunner,
    private readonly taskRunner: TaskRunner,
    private readonly workerManager: WorkerManagerService,
    private readonly mcpService: McpService | null = null,
  ) {}

  async getStatus(): Promise<SystemStatusResponse> {
    const scheduler = this.scheduler.getStatus();
    const providerConfigured = this.agent.providerConfigured;
    const models = await this.agent.getModels();
    const usageFields = this.agent.getUsageStatusFields();

    const [telegramPm2, whatsappPm2] = await Promise.all([
      this.workerManager.getWorkerStatus("telegram"),
      this.workerManager.getWorkerStatus("whatsapp"),
    ]);

    const telegramStatus = this.resolveWorkerStatus("telegram", telegramPm2);
    const whatsappStatus = this.resolveWorkerStatus("whatsapp", whatsappPm2);

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
      telegramWorker: telegramStatus,
      whatsappWorker: whatsappStatus,
      llmUsage: this.getLlmUsage(
        models.provider,
        models.currentModel,
        providerConfigured,
        usageFields,
      ),
      mcp: this.mcpService
        ? await this.mcpService.getStatusSummary()
        : { serverCount: 0, connectedCount: 0, assignedProfileCount: 0 },
      checkedAt: new Date().toISOString(),
    };
  }

  private async resolveWorkerStatus(
    name: "telegram" | "whatsapp",
    pm2Status: WorkerProcessInfo | null,
  ) {
    if (pm2Status?.managed) {
      const running = pm2Status.status === "online";

      if (name === "telegram") {
        const heartbeat = await getTelegramWorkerStatus();
        return {
          ...heartbeat,
          running,
          process: pm2Status,
        };
      }

      const heartbeat = await getWhatsAppWorkerStatus();
      return {
        ...heartbeat,
        running,
        process: pm2Status,
      };
    }

    if (name === "telegram") {
      const heartbeat = await getTelegramWorkerStatus();
      return heartbeat;
    }

    const heartbeat = await getWhatsAppWorkerStatus();
    return heartbeat;
  }

  private getLlmUsage(
    provider: LlmUsageStatus["provider"],
    currentModel: string | null,
    providerConfigured: boolean,
    usageFields: { displayName: string | null; costEstimated: boolean },
  ): LlmUsageStatus {
    return {
      ...this.agent.getLlmUsageStats(),
      provider,
      currentModel,
      providerConfigured,
      displayName: usageFields.displayName,
      costEstimated: usageFields.costEstimated,
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
