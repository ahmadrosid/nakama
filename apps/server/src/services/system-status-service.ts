import type {
  HealthResponse,
  LlmUsageStatus,
  SystemStatusResponse,
  WorkerProcessInfo,
} from "@nakama/core";
import {
  getAutomationWorkerHeartbeatStatus,
  getDiscordWorkerStatus,
  getNakamaVersion,
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
import type { WorkerManagerService } from "./worker-manager-service";

export class SystemStatusService {
  constructor(
    private readonly agent: AgentService,
    private readonly automationRunner: AutomationRunner,
    private readonly workerManager: WorkerManagerService,
    private readonly mcpService: McpService | null = null,
    private readonly composioService: ComposioService | null = null,
    private readonly databaseAdapter: DatabaseAdapter | null = null
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
      automationProcess?.managed === true &&
      automationProcess.status === "online";

    const [telegramStatus, whatsappStatus, discordStatus] = await Promise.all([
      this.resolveWorkerStatus("telegram", statuses.telegram),
      this.resolveWorkerStatus("whatsapp", statuses.whatsapp),
      this.resolveWorkerStatus("discord", statuses.discord),
    ]);

    return {
      automationWorker: {
        activeRuns: this.automationRunner.getActiveRunCount(),
        ok: automationManagedOnline && automationRunning,
        process: automationProcess ?? undefined,
        providerConfigured,
        running: automationRunning,
        scheduledJobs: automationRunning
          ? automationHeartbeat.scheduledJobs
          : 0,
      },
      checkedAt: new Date().toISOString(),
      discordWorker: discordStatus,
      llmUsage: this.getLlmUsage(
        models.provider,
        usageFields.currentModel,
        providerConfigured,
        usageFields,
        this.agent.getLlmUsageStatsByModel()
      ),
      mcp: this.mcpService
        ? await this.mcpService.getStatusSummary()
        : { assignedProfileCount: 0, connectedCount: 0, serverCount: 0 },
      server: await this.getServerStatus(),
      telegramWorker: telegramStatus,
      whatsappWorker: whatsappStatus,
    };
  }

  private async resolveWorkerStatus(
    name: "telegram" | "whatsapp" | "discord",
    pm2Status: WorkerProcessInfo | null
  ) {
    if (pm2Status?.managed) {
      const running = pm2Status.status === "online";

      if (name === "telegram") {
        const heartbeat = await getTelegramWorkerStatus();
        return {
          ...heartbeat,
          process: pm2Status,
          running,
        };
      }

      if (name === "discord") {
        const heartbeat = await getDiscordWorkerStatus();
        return {
          ...heartbeat,
          process: pm2Status,
          running,
        };
      }

      const heartbeat = await getWhatsAppWorkerStatus();
      return {
        ...heartbeat,
        process: pm2Status,
        running,
      };
    }

    if (name === "telegram") {
      return getTelegramWorkerStatus();
    }

    if (name === "discord") {
      return getDiscordWorkerStatus();
    }

    return getWhatsAppWorkerStatus();
  }

  private getLlmUsage(
    provider: LlmUsageStatus["provider"],
    currentModel: string | null,
    providerConfigured: boolean,
    usageFields: { displayName: string | null; costEstimated: boolean },
    models: LlmUsageStatus["models"]
  ): LlmUsageStatus {
    return {
      ...this.agent.getLlmUsageStats(),
      costEstimated: usageFields.costEstimated,
      currentModel,
      displayName: usageFields.displayName,
      models,
      provider,
      providerConfigured,
    };
  }

  private async getServerStatus(): Promise<HealthResponse> {
    const composioConfigured = await isComposioConfiguredAsync();
    const humanUserCount = (await this.databaseAdapter?.countHumanUsers()) ?? 0;

    return {
      apiVersion: NAKAMA_API_VERSION,
      // Live probe — intentional here; /health skips this to stay fast.
      composioAvailable: composioConfigured
        ? await (this.composioService?.isReachable() ?? false)
        : false,
      composioConfigured,
      ok: true,
      providerConfigured: this.agent.providerConfigured,
      userConfigured: humanUserCount > 0,
      version: getNakamaVersion(),
    };
  }
}
