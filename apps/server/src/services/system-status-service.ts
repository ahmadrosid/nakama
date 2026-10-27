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
  type ChannelOwner,
  isChannelOwner,
} from "@nakama/core/channel-config-shared";
import { getSlackWorkerStatus } from "@nakama/core/slack-worker";
import { getTeamsWorkerStatus } from "@nakama/core/teams-worker";
import type { DatabaseAdapter } from "@nakama/db";
import type { AgentService } from "./agent-service";
import type { AutomationRunner } from "./automation-runner";
import type { ComposioService } from "./composio-service";
import type { McpService } from "./mcp-service";
import type { WorkerManagerService } from "./worker-manager-service";

export class SystemStatusService {
  constructor(
    private readonly agent: Pick<
      AgentService,
      | "providerConfigured"
      | "getModels"
      | "getUsageStatusFields"
      | "getLlmUsageStats"
      | "getLlmUsageStatsByModel"
      | "getLlmUsageDailyStats"
      | "getLlmUsageStatsByActor"
    >,
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
    options: {
      includeUsageByActor?: boolean;
      viewer?: { isPlatformAdmin: boolean; userId: string };
    } = {}
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

    const teamsProcess = statuses.teams;

    const teamsStatus = await getTeamsWorkerStatus(orgId);

    if (isChannelOwner(orgId) && teamsProcess?.managed) {
      teamsStatus.process = teamsProcess;
      teamsStatus.running = teamsProcess.status === "online";
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
      teamsWorker: teamsStatus,
      telegramWorker: telegramStatus,
      whatsappWorker: await this.nameWhatsAppLinkOwner(
        whatsappStatus,
        options.viewer
      ),
    };
  }

  /**
   * Orgs are tenants: name the agent that holds a rejected number only for a
   * viewer who belongs to its org or runs the platform.
   */
  private async nameWhatsAppLinkOwner(
    status: SystemStatusResponse["whatsappWorker"] & {
      linkOwnerIds?: ChannelOwner;
    },
    viewer: { isPlatformAdmin: boolean; userId: string } | undefined
  ): Promise<SystemStatusResponse["whatsappWorker"]> {
    const { linkOwnerIds, ...rest } = status;
    const db = this.databaseAdapter;

    if (!(linkOwnerIds && viewer && db)) {
      return rest;
    }

    const canSee =
      viewer.isPlatformAdmin ||
      (await db.getOrgMember(linkOwnerIds.orgId, viewer.userId)) !== null;

    if (!canSee) {
      return rest;
    }

    const [org, profile] = await Promise.all([
      db.getOrganizationById(linkOwnerIds.orgId),
      db.getProfileForOrg(linkOwnerIds.profileId, linkOwnerIds.orgId),
    ]);

    return org && profile
      ? { ...rest, linkOwner: { agentName: profile.name, orgName: org.name } }
      : rest;
  }

  private resolveWorkerStatus(
    name: "telegram",
    pm2Status: WorkerProcessInfo | null,
    orgId: ChannelConfigScope
  ): Promise<SystemStatusResponse["telegramWorker"]>;
  private resolveWorkerStatus(
    name: "whatsapp",
    pm2Status: WorkerProcessInfo | null,
    orgId: ChannelConfigScope
  ): Promise<SystemStatusResponse["whatsappWorker"]>;
  private resolveWorkerStatus(
    name: "discord",
    pm2Status: WorkerProcessInfo | null,
    orgId: ChannelConfigScope
  ): Promise<SystemStatusResponse["discordWorker"]>;
  private async resolveWorkerStatus(
    name: "telegram" | "whatsapp" | "discord",
    pm2Status: WorkerProcessInfo | null,
    orgId: ChannelConfigScope
  ): Promise<
    | SystemStatusResponse["telegramWorker"]
    | SystemStatusResponse["whatsappWorker"]
    | SystemStatusResponse["discordWorker"]
  > {
    if (!isChannelOwner(orgId)) {
      return {
        configured: false,
        connected: false,
        ok: true,
        paired: false,
        qrCode: null,
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
      onboardingEnabled: isOnboardingEnabled(),
      providerConfigured: this.agent.providerConfigured,
      userConfigured: humanUserCount > 0,
      version: getNakamaVersion(),
    };
  }
}

/** Off unless the operator turns it on with `NAKAMA_ENABLE_ONBOARDING`. */
export function isOnboardingEnabled(): boolean {
  const value = process.env.NAKAMA_ENABLE_ONBOARDING?.trim().toLowerCase();

  return value === "1" || value === "true";
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
