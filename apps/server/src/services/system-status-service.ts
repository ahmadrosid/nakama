import type {
  HealthResponse,
  LlmUsageStats,
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
import {
  type ChannelConfigScope,
  isChannelOwner,
} from "@nakama/core/channel-config-shared";
import { getSlackWorkerStatus } from "@nakama/core/slack-worker";
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

  /**
   * `includeUsageByActor` adds usage per agent and per user. It names who
   * spent what, so only org admins and platform admins get it.
   */
  async getStatus(
    orgId: ChannelConfigScope,
    options: { includeUsageByActor?: boolean } = {}
  ): Promise<SystemStatusResponse> {
    const providerConfigured = this.agent.providerConfigured;
    const models = await this.agent.getModels();
    const usageFields = this.agent.getUsageStatusFields();

    // Usage is a tenant ledger: read it with the same scope the request
    // already resolved, never install-wide, or one org reads another's spend.
    const usageOrgId = isString(orgId) ? orgId : (orgId?.orgId ?? null);

    const [usageStats, usageByModel, usageDaily, usageByActor] =
      await Promise.all([
        this.agent.getLlmUsageStats(usageOrgId),
        this.agent.getLlmUsageStatsByModel(usageOrgId),
        this.agent.getLlmUsageDailyStats(usageOrgId),
        options.includeUsageByActor && usageOrgId
          ? this.agent.getLlmUsageStatsByActor(usageOrgId)
          : null,
      ]);

    const statuses = await this.workerManager.getAllWorkerStatuses(orgId);
    const automationProcess = statuses.automation ?? null;
    const automationHeartbeat = await getAutomationWorkerHeartbeatStatus();
    const automationRunning = automationHeartbeat.running;

    const automationManagedOnline =
      automationProcess?.managed === true &&
      automationProcess.status === "online";

    const [telegramStatus, whatsappStatus, discordStatus] = await Promise.all([
      this.resolveWorkerStatus("telegram", statuses.telegram, orgId),
      this.resolveWorkerStatus("whatsapp", statuses.whatsapp, orgId),
      this.resolveWorkerStatus("discord", statuses.discord, orgId),
    ]);

    // Typed on its own so SlackWorkerStatus stays exact; the shared helper
    // returns a union of every channel's status shape.
    const slackProcess = statuses.slack;

    const slackStatus = await getSlackWorkerStatus(orgId);

    if (isChannelOwner(orgId) && slackProcess?.managed) {
      slackStatus.process = slackProcess;
      slackStatus.running = slackProcess.status === "online";
    }

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
      llmUsage: {
        ...this.getLlmUsage(
          models.provider,
          usageFields.currentModel,
          providerConfigured,
          usageFields,
          usageByModel,
          usageDaily,
          usageStats
        ),
        ...(usageByActor ?? {}),
      },
      mcp: this.mcpService
        ? await this.mcpService.getStatusSummary()
        : { assignedProfileCount: 0, connectedCount: 0, serverCount: 0 },
      server: await this.getServerStatus(),
      slackWorker: slackStatus,
      telegramWorker: telegramStatus,
      whatsappWorker: whatsappStatus,
    };
  }

  private async resolveWorkerStatus(
    name: "telegram" | "whatsapp" | "discord",
    pm2Status: WorkerProcessInfo | null,
    orgId: ChannelConfigScope
  ) {
    if (!isChannelOwner(orgId)) {
      return {
        configured: false,
        connected: false,
        ok: true,
        paired: false,
        running: false,
      };
    }

    if (pm2Status?.managed) {
      const running = pm2Status.status === "online";

      if (name === "telegram") {
        const heartbeat = await getTelegramWorkerStatus(orgId);

        return {
          ...heartbeat,
          process: pm2Status,
          running,
        };
      }

      if (name === "discord") {
        const heartbeat = await getDiscordWorkerStatus(orgId);

        return {
          ...heartbeat,
          process: pm2Status,
          running,
        };
      }

      const heartbeat = await getWhatsAppWorkerStatus(orgId);

      return {
        ...heartbeat,
        process: pm2Status,
        running,
      };
    }

    // Keep the unmanaged info so the UI can show why PM2 failed.
    const process = pm2Status ?? undefined;

    if (name === "telegram") {
      return { ...(await getTelegramWorkerStatus(orgId)), process };
    }

    if (name === "discord") {
      return { ...(await getDiscordWorkerStatus(orgId)), process };
    }

    return { ...(await getWhatsAppWorkerStatus(orgId)), process };
  }

  private getLlmUsage(
    provider: LlmUsageStatus["provider"],
    currentModel: string | null,
    providerConfigured: boolean,
    usageFields: { displayName: string | null; costEstimated: boolean },
    models: LlmUsageStatus["models"],
    daily: LlmUsageStatus["daily"],
    stats: LlmUsageStats
  ): LlmUsageStatus {
    return {
      ...stats,
      costEstimated: usageFields.costEstimated,
      currentModel,
      daily,
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

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
