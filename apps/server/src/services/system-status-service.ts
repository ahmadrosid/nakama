import type { HealthResponse, LlmUsageStatus, SystemStatusResponse, WorkerProcessInfo } from "@nakama/core";
import {
  getAutomationWorkerHeartbeatStatus,
  getTelegramWorkerStatus,
  getWhatsAppWorkerStatus,
  isComposioConfiguredAsync,
  NAKAMA_API_VERSION,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import type { AgentService } from "./agent-service";
import type { AutomationRunner } from "./automation-runner";
import type { ComposioService } from "./composio-service";
import type { McpService } from "./mcp-service";
import type { TaskRunner } from "./task-runner";
import type { WorkerManagerService } from "./worker-manager-service";

export class SystemStatusService {
  constructor(
    private readonly agent: AgentService,
    private readonly automationRunner: AutomationRunner,
    private readonly taskRunner: TaskRunner,
    private readonly workerManager: WorkerManagerService,
    private readonly mcpService: McpService | null = null,
    private readonly composioService: ComposioService | null = null,
    private readonly databaseAdapter: DatabaseAdapter | null = null,
  ) {}

  async getStatus(): Promise<SystemStatusResponse> {
    const providerConfigured = this.agent.providerConfigured;
    const models = await this.agent.getModels();
    const usageFields = this.agent.getUsageStatusFields();

    const statuses = await this.workerManager.getAllWorkerStatuses();
    const automationProcess = statuses.automation ?? null;
    const automationHeartbeat = await getAutomationWorkerHeartbeatStatus();
    const automationRunning = automationHeartbeat.running;
    const automationManagedOnline =
      automationProcess?.managed === true && automationProcess.status === "online";

    const [telegramStatus, whatsappStatus] = await Promise.all([
      this.resolveWorkerStatus("telegram", statuses.telegram),
      this.resolveWorkerStatus("whatsapp", statuses.whatsapp),
    ]);

    return {
      server: await this.getServerStatus(),
      automationWorker: {
        ok: automationManagedOnline && automationRunning,
        running: automationRunning,
        scheduledJobs: automationRunning ? automationHeartbeat.scheduledJobs : 0,
        activeRuns: this.automationRunner.getActiveRunCount(),
        providerConfigured,
        process: automationProcess ?? undefined,
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
        usageFields.currentModel,
        providerConfigured,
        usageFields,
        this.agent.getLlmUsageStatsByModel(),
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
    models: LlmUsageStatus["models"],
  ): LlmUsageStatus {
    return {
      ...this.agent.getLlmUsageStats(),
      provider,
      currentModel,
      providerConfigured,
      displayName: usageFields.displayName,
      costEstimated: usageFields.costEstimated,
      models,
    };
  }

  private async getServerStatus(): Promise<HealthResponse> {
    const composioConfigured = await isComposioConfiguredAsync();
    const humanUserCount = (await this.databaseAdapter?.countHumanUsers()) ?? 0;

    return {
      ok: true,
      apiVersion: NAKAMA_API_VERSION,
      providerConfigured: this.agent.providerConfigured,
      userConfigured: humanUserCount > 0,
      composioConfigured,
      composioAvailable: composioConfigured
        ? await (this.composioService?.isReachable() ?? false)
        : false,
    };
  }
}
