import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  HealthResponse,
  LlmUsageStats,
  LlmUsageStatus,
  NakamaUpgradeResponse,
  NakamaVersionResponse,
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
  NakamaApiError,
} from "@nakama/core";
import {
  type ChannelConfigScope,
  type ChannelOwner,
  isChannelOwner,
} from "@nakama/core/channel-config-shared";
import { getSlackWorkerStatus } from "@nakama/core/slack-worker";
import { getTeamsWorkerStatus } from "@nakama/core/teams-worker";
import type { DatabaseAdapter } from "@nakama/db";
import { z } from "zod";
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
      updateCheckEnabled: isUpdateCheckEnabled(),
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

/** On unless the operator turns it off with `NAKAMA_DISABLE_UPDATE_CHECK`, e.g. a host that upgrades instances itself. */
export function isUpdateCheckEnabled(): boolean {
  const value = process.env.NAKAMA_DISABLE_UPDATE_CHECK?.trim().toLowerCase();

  return !(value === "1" || value === "true");
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/ahmadrosid/nakama/releases/latest";

const RELEASE_CACHE_MS = 10 * 60 * 1000;

const releaseSchema = z.object({
  html_url: z.string(),
  tag_name: z.string(),
});

let cachedRelease: { at: number; latest: string; releaseUrl: string } | null =
  null;

function versionParts(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());

  return match ? match.slice(1).map(Number) : null;
}

function isNewer(latest: string, current: string): boolean {
  const a = versionParts(latest);
  const b = versionParts(current);

  if (!(a && b)) {
    return false;
  }

  const diff = a.map((part, index) => part - (b[index] ?? 0)).find(Boolean);

  return (diff ?? 0) > 0;
}

/** Cached for 10 minutes: anonymous GitHub API calls are limited to 60 per hour per IP. */
export async function checkNakamaVersion(
  current: string,
  now = Date.now()
): Promise<NakamaVersionResponse> {
  if (!cachedRelease || now - cachedRelease.at > RELEASE_CACHE_MS) {
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);

    const parsed = releaseSchema.safeParse(
      response?.ok ? await response.json() : null
    );

    if (!parsed.success) {
      throw new NakamaApiError("Could not reach GitHub releases.", 502);
    }

    cachedRelease = {
      at: now,
      latest: parsed.data.tag_name.replace(/^v/i, ""),
      releaseUrl: parsed.data.html_url,
    };
  }

  return {
    current,
    latest: cachedRelease.latest,
    releaseUrl: cachedRelease.releaseUrl,
    updateAvailable: isNewer(cachedRelease.latest, current),
  };
}

const UPDATER_STALE_MS = 30_000;

const upgradeStatusSchema = z.object({
  at: z.string(),
  message: z.string(),
  progress: z.object({ done: z.number(), total: z.number() }).optional(),
  state: z.enum(["running", "done", "failed", "rolled_back"]),
  version: z.string(),
});

function updaterDir(): string | null {
  return process.env.NAKAMA_UPDATER_DIR?.trim() || null;
}

const ARCHIVE_NAME = /^pre-upgrade-(\d+\.\d+\.\d+)-(\d{8}T\d{6}Z)\.tar\.gz$/;

/** The updater archives the data each time it leaves a version. */
async function listRollbacks(
  current: string
): Promise<NakamaUpgradeResponse["rollbacks"]> {
  const dir = process.env.NAKAMA_BACKUP_DIR?.trim();
  const names = dir ? await readdir(dir).catch(() => []) : [];
  const newest = new Map<string, string>();

  for (const name of names.sort().reverse()) {
    const [, version, stamp] = ARCHIVE_NAME.exec(name) ?? [];

    if (version && stamp && version !== current && !newest.has(version)) {
      newest.set(version, stamp);
    }
  }

  return [...newest].map(([version, stamp]) => ({
    at: stamp.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      "$1-$2-$3T$4:$5:$6Z"
    ),
    version,
  }));
}

/** The updater touches its heartbeat every two seconds while it waits. */
export async function readUpgradeState(
  current: string,
  now = Date.now()
): Promise<NakamaUpgradeResponse> {
  const dir = updaterDir();

  if (!dir) {
    return { available: false, rollbacks: [], status: null };
  }

  const beat = await stat(join(dir, "heartbeat")).catch(() => null);

  const status = upgradeStatusSchema.safeParse(
    await readFile(join(dir, "status.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null)
  );

  const available = beat !== null && now - beat.mtimeMs < UPDATER_STALE_MS;

  // The updater takes a request within two seconds. Until then the last run's
  // status is all there is, and the button would look like the click did nothing.
  const waiting = available
    ? await readFile(join(dir, "request"), "utf8").catch(() => null)
    : null;

  if (waiting) {
    return {
      available,
      rollbacks: await listRollbacks(current),
      status: {
        at: new Date(now).toISOString(),
        message: "Starting.",
        state: "running",
        version: waiting.trim().split(" ").at(-1) ?? "",
      },
    };
  }

  return {
    available,
    rollbacks: await listRollbacks(current),
    status: status.success ? status.data : null,
  };
}

export async function requestUpgrade(
  version: string,
  current: string,
  action: "upgrade" | "rollback" = "upgrade"
): Promise<NakamaUpgradeResponse> {
  const state = await readUpgradeState(current);
  const dir = updaterDir();

  if (!(dir && state.available)) {
    throw new NakamaApiError("The updater service is not running.", 409);
  }

  if (state.status?.state === "running") {
    throw new NakamaApiError("An upgrade is already running.", 409);
  }

  if (
    action === "rollback" &&
    !state.rollbacks.some((entry) => entry.version === version)
  ) {
    throw new NakamaApiError(`There is no archive of ${version}.`, 400);
  }

  if (action === "upgrade" && !isNewer(version, current)) {
    throw new NakamaApiError(
      `${version} is not a release newer than ${current}.`,
      400
    );
  }

  await writeFile(join(dir, "request"), `${action} ${version}\n`);

  return state;
}
