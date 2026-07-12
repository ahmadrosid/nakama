import {
  composioOrgUserId,
  createId,
  loadComposioConfigFile,
  NakamaApiError,
  nanoid,
  resolveComposioApiKey,
  type ComposioCatalogToolkitSummary,
  type ComposioConnectResponse,
  type ComposioToolkitSummary,
  type ListComposioToolkitsResponse,
  type ListProfileComposioToolkitsResponse,
  type ProfileComposioToolkitAssignment,
  type UpdateProfileComposioToolkitsRequest,
} from "@nakama/core";
import { normalizeEnableComposioToolkitRequest, normalizeUpdateProfileComposioToolkitsRequest } from "@nakama/core";
import type {
  DatabaseAdapter,
  StoredComposioToolkitRecord,
  StoredProfileComposioToolkitRecord,
  StoredProfileRecord,
} from "@nakama/db";
import type { AuthService } from "./auth-service";
import {
  createComposioApiClient,
  type ComposioApiClient,
  type ComposioSessionMcpEndpoint,
} from "./composio-api-client";
import { decryptComposioSecret, encryptComposioSecret } from "./composio-secret";

export interface ComposioOAuthStatePayload {
  orgId: string;
  toolkitId: string;
  nonce: string;
}

function toToolkitSummary(record: StoredComposioToolkitRecord): ComposioToolkitSummary {
  return {
    id: record.id,
    toolkitSlug: record.toolkitSlug,
    displayName: record.displayName,
    status: record.status,
    connectedAccountId: record.connectedAccountId,
    cachedTools: record.cachedTools,
    lastError: record.lastError,
    updatedAt: record.updatedAt,
  };
}

function titleCaseToolkit(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export class ComposioService {
  private apiClientCache: { key: string; client: ComposioApiClient } | null = null;

  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService,
  ) {}

  reloadConfiguration(): void {
    this.apiClientCache = null;
  }

  private async resolveApiKey(): Promise<string> {
    return resolveComposioApiKey(await loadComposioConfigFile());
  }

  private async getApiClient(): Promise<ComposioApiClient | null> {
    const apiKey = await this.resolveApiKey();

    if (!apiKey) {
      return null;
    }

    if (this.apiClientCache?.key === apiKey) {
      return this.apiClientCache.client;
    }

    const client = createComposioApiClient(apiKey);
    this.apiClientCache = { key: apiKey, client };
    return client;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(await this.getApiClient());
  }

  async listToolkits(orgId: string): Promise<ListComposioToolkitsResponse> {
    const apiClient = await this.getApiClient();
    const composioAvailable = apiClient !== null;
    const orgToolkits = (await this.databaseAdapter.listComposioToolkitsForOrg(orgId)).map(
      toToolkitSummary,
    );

    if (!composioAvailable) {
      return { composioAvailable: false, catalog: [], orgToolkits };
    }

    let catalog: ComposioCatalogToolkitSummary[] = [];

    try {
      const remoteCatalog = await apiClient.listCatalogToolkits();
      catalog = remoteCatalog.map((toolkit) => ({
        slug: toolkit.slug,
        name: toolkit.name,
        description: toolkit.description,
      }));
    } catch (error) {
      return {
        composioAvailable: true,
        catalog: [],
        orgToolkits: orgToolkits.map((toolkit) => ({
          ...toolkit,
          lastError:
            error instanceof Error ? error.message : "Failed to load Composio toolkit catalog.",
        })),
      };
    }

    return { composioAvailable: true, catalog, orgToolkits };
  }

  async enableToolkit(orgId: string, input: unknown): Promise<ComposioToolkitSummary> {
    await this.requireAvailable();
    const request = normalizeEnableComposioToolkitRequest(input);
    const existing = await this.databaseAdapter.getComposioToolkitBySlug(orgId, request.toolkitSlug);
    const now = new Date().toISOString();

    if (existing) {
      const updated: StoredComposioToolkitRecord = {
        ...existing,
        status: existing.status === "disabled" ? "enabled" : existing.status,
        lastError: null,
        updatedAt: now,
      };
      await this.databaseAdapter.upsertComposioToolkit(updated);
      return toToolkitSummary(updated);
    }

    const record: StoredComposioToolkitRecord = {
      id: createId("ctk"),
      orgId,
      toolkitSlug: request.toolkitSlug,
      displayName: titleCaseToolkit(request.toolkitSlug),
      status: "enabled",
      connectedAccountId: null,
      sessionIdEnc: null,
      oauthStateHash: null,
      cachedTools: [],
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.databaseAdapter.upsertComposioToolkit(record);
    return toToolkitSummary(record);
  }

  async disableToolkit(orgId: string, toolkitSlug: string): Promise<ComposioToolkitSummary> {
    const record = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);
    const updated: StoredComposioToolkitRecord = {
      ...record,
      status: "disabled",
      updatedAt: new Date().toISOString(),
    };
    await this.databaseAdapter.upsertComposioToolkit(updated);
    return toToolkitSummary(updated);
  }

  async connectToolkit(
    orgId: string,
    toolkitSlug: string,
    callbackBaseUrl: string,
  ): Promise<ComposioConnectResponse> {
    const apiClient = await this.requireAvailable();
    const record = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);

    if (record.status === "disabled") {
      throw new NakamaApiError("Enable the toolkit before connecting.", 400);
    }

    const oauthNonce = nanoid(32);
    const state = Buffer.from(
      JSON.stringify({
        orgId,
        toolkitId: record.id,
        nonce: oauthNonce,
      } satisfies ComposioOAuthStatePayload),
    ).toString("base64url");
    const callbackUrl = `${callbackBaseUrl.replace(/\/$/, "")}/v1/composio/oauth/callback?state=${encodeURIComponent(state)}`;
    const link = await apiClient.linkToolkitAccount(
      composioOrgUserId(orgId),
      toolkitSlug,
      callbackUrl,
    );

    const updated: StoredComposioToolkitRecord = {
      ...record,
      status: "oauth_in_progress",
      oauthStateHash: this.authService.hashToken(oauthNonce),
      connectedAccountId: link.connectedAccountId ?? record.connectedAccountId,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };

    await this.databaseAdapter.upsertComposioToolkit(updated);

    return { redirectUrl: link.redirectUrl };
  }

  async completeOAuth(state: string): Promise<{ orgId: string; toolkitSlug: string }> {
    await this.requireAvailable();

    let payload: ComposioOAuthStatePayload;

    try {
      payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as ComposioOAuthStatePayload;
    } catch {
      throw new NakamaApiError("Invalid OAuth state.", 400);
    }

    const record = await this.getOwnedToolkit(payload.orgId, payload.toolkitId);

    if (!record.oauthStateHash || this.authService.hashToken(payload.nonce) !== record.oauthStateHash) {
      throw new NakamaApiError("Invalid OAuth state.", 400);
    }

    const updated: StoredComposioToolkitRecord = {
      ...record,
      status: "connected",
      oauthStateHash: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };

    await this.databaseAdapter.upsertComposioToolkit(updated);
    await this.syncToolkit(payload.orgId, record.toolkitSlug);

    return { orgId: payload.orgId, toolkitSlug: record.toolkitSlug };
  }

  async disconnectToolkit(orgId: string, toolkitSlug: string): Promise<ComposioToolkitSummary> {
    const apiClient = await this.requireAvailable();
    const record = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);

    if (record.connectedAccountId) {
      try {
        await apiClient.deleteConnectedAccount(record.connectedAccountId);
      } catch {
        // Best-effort remote revoke; local state still clears below.
      }
    }

    const updated: StoredComposioToolkitRecord = {
      ...record,
      status: record.status === "disabled" ? "disabled" : "enabled",
      connectedAccountId: null,
      sessionIdEnc: null,
      oauthStateHash: null,
      cachedTools: [],
      lastError: null,
      updatedAt: new Date().toISOString(),
    };

    await this.databaseAdapter.upsertComposioToolkit(updated);
    return toToolkitSummary(updated);
  }

  async syncToolkit(orgId: string, toolkitSlug: string): Promise<ComposioToolkitSummary> {
    const apiClient = await this.requireAvailable();
    const record = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);

    if (record.status !== "connected") {
      throw new NakamaApiError("Connect the toolkit before syncing tools.", 400);
    }

    try {
      const session = await this.openOrgSession(orgId, [record.toolkitSlug], {
        [record.toolkitSlug]: null,
      });
      const cachedTools = await apiClient.listSessionTools(session);
      const updated: StoredComposioToolkitRecord = {
        ...record,
        sessionIdEnc: await this.encryptSessionId(session.sessionId),
        cachedTools,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
      await this.databaseAdapter.upsertComposioToolkit(updated);
      return toToolkitSummary(updated);
    } catch (error) {
      const updated: StoredComposioToolkitRecord = {
        ...record,
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      };
      await this.databaseAdapter.upsertComposioToolkit(updated);
      throw error;
    }
  }

  async listProfileAssignments(
    orgId: string,
    profile: StoredProfileRecord,
  ): Promise<ListProfileComposioToolkitsResponse> {
    this.assertProfileOrg(profile, orgId);
    const assignments = await this.databaseAdapter.listProfileComposioToolkits(profile.id);
    const orgToolkits = await this.databaseAdapter.listComposioToolkitsForOrg(orgId);
    const toolkitById = new Map(orgToolkits.map((toolkit) => [toolkit.id, toolkit]));

    return {
      assignments: assignments
        .map((assignment) => {
          const toolkit = toolkitById.get(assignment.toolkitId);
          if (!toolkit) {
            return null;
          }

          return {
            toolkitId: assignment.toolkitId,
            toolkitSlug: toolkit.toolkitSlug,
            allowedActions: assignment.allowedActions,
          } satisfies ProfileComposioToolkitAssignment;
        })
        .filter((assignment): assignment is ProfileComposioToolkitAssignment => assignment !== null),
    };
  }

  async updateProfileAssignments(
    orgId: string,
    profile: StoredProfileRecord,
    input: unknown,
  ): Promise<ListProfileComposioToolkitsResponse> {
    this.assertProfileOrg(profile, orgId);
    const request: UpdateProfileComposioToolkitsRequest =
      normalizeUpdateProfileComposioToolkitsRequest(input);
    const orgToolkits = await this.databaseAdapter.listComposioToolkitsForOrg(orgId);
    const toolkitById = new Map(orgToolkits.map((toolkit) => [toolkit.id, toolkit]));
    const assignments: StoredProfileComposioToolkitRecord[] = [];

    for (const assignment of request.assignments) {
      const toolkit = toolkitById.get(assignment.toolkitId);

      if (!toolkit || toolkit.orgId !== orgId) {
        throw new NakamaApiError("Composio toolkit not found for this organization.", 404);
      }

      assignments.push({
        profileId: profile.id,
        toolkitId: assignment.toolkitId,
        allowedActions: assignment.allowedActions ?? null,
      });
    }

    await this.databaseAdapter.replaceProfileComposioToolkits(profile.id, assignments);
    return this.listProfileAssignments(orgId, profile);
  }

  async getProfileSessionEndpoint(
    orgId: string,
    profileId: string,
  ): Promise<ComposioSessionMcpEndpoint | null> {
    const apiClient = await this.getApiClient();

    if (!apiClient) {
      return null;
    }

    const assignments = await this.databaseAdapter.listProfileComposioToolkits(profileId);
    if (assignments.length === 0) {
      return null;
    }

    const orgToolkits = await this.databaseAdapter.listComposioToolkitsForOrg(orgId);
    const toolkitById = new Map(orgToolkits.map((toolkit) => [toolkit.id, toolkit]));
    const enabledToolkits: string[] = [];
    const allowedToolsByToolkit: Record<string, string[] | null> = {};

    for (const assignment of assignments) {
      const toolkit = toolkitById.get(assignment.toolkitId);
      if (!toolkit || toolkit.status !== "connected") {
        continue;
      }

      enabledToolkits.push(toolkit.toolkitSlug);
      allowedToolsByToolkit[toolkit.toolkitSlug] = assignment.allowedActions;
    }

    if (enabledToolkits.length === 0) {
      return null;
    }

    const existingSessionId = await this.readExistingSessionId(orgToolkits, enabledToolkits);
    const userId = composioOrgUserId(orgId);

    if (existingSessionId) {
      return apiClient.reuseProfileSession(
        existingSessionId,
        enabledToolkits,
        allowedToolsByToolkit,
      );
    }

    return apiClient.createProfileSession(userId, enabledToolkits, allowedToolsByToolkit);
  }

  async formatProfileConnectionsContext(orgId: string, profileId: string): Promise<string> {
    if (!(await this.isAvailable())) {
      return "";
    }

    const assigned = await this.getAssignedToolkitRecords(orgId, profileId);
    if (assigned.length === 0) {
      return "";
    }

    const lines = assigned.map(({ toolkit, allowedActions }) => {
      const toolCount = toolkit.cachedTools.length;
      const toolsSuffix = toolCount > 0 ? `, ${toolCount} tool${toolCount === 1 ? "" : "s"}` : "";
      const actionsSuffix =
        allowedActions && allowedActions.length > 0
          ? ` (allowed actions: ${allowedActions.join(", ")})`
          : "";

      return `- ${toolkit.displayName} (\`${toolkit.toolkitSlug}\`): ${toolkit.status}${toolsSuffix}${actionsSuffix}`;
    });

    return [
      "## Composio integrations",
      "",
      "Assigned SaaS toolkits for this profile:",
      ...lines,
      "",
      "Use assigned Composio tools for external SaaS actions. Org admins connect apps on Integrations — never self-authorize OAuth.",
    ].join("\n");
  }

  async getAssignedToolkitRecords(
    orgId: string,
    profileId: string,
  ): Promise<Array<{ toolkit: StoredComposioToolkitRecord; allowedActions: string[] | null }>> {
    const assignments = await this.databaseAdapter.listProfileComposioToolkits(profileId);
    const orgToolkits = await this.databaseAdapter.listComposioToolkitsForOrg(orgId);
    const toolkitById = new Map(orgToolkits.map((toolkit) => [toolkit.id, toolkit]));

    return assignments
      .map((assignment) => {
        const toolkit = toolkitById.get(assignment.toolkitId);
        return toolkit ? { toolkit, allowedActions: assignment.allowedActions } : null;
      })
      .filter((entry): entry is { toolkit: StoredComposioToolkitRecord; allowedActions: string[] | null } =>
        entry !== null,
      );
  }

  private async openOrgSession(
    orgId: string,
    toolkitSlugs: string[],
    allowedToolsByToolkit: Record<string, string[] | null>,
  ): Promise<ComposioSessionMcpEndpoint> {
    const apiClient = await this.requireAvailable();
    return apiClient.createProfileSession(
      composioOrgUserId(orgId),
      toolkitSlugs,
      allowedToolsByToolkit,
    );
  }

  private async readExistingSessionId(
    orgToolkits: StoredComposioToolkitRecord[],
    enabledToolkits: string[],
  ): Promise<string | null> {
    const secret = await this.resolveApiKey();
    if (!secret) {
      return null;
    }

    const enabled = new Set(enabledToolkits);

    for (const toolkit of orgToolkits) {
      if (!enabled.has(toolkit.toolkitSlug) || !toolkit.sessionIdEnc) {
        continue;
      }

      try {
        return decryptComposioSecret(toolkit.sessionIdEnc, secret);
      } catch {
        return null;
      }
    }

    return null;
  }

  private async encryptSessionId(sessionId: string): Promise<string> {
    const secret = await this.resolveApiKey();
    if (!secret) {
      throw new Error("Composio API key is not configured.");
    }

    return encryptComposioSecret(sessionId, secret);
  }

  private async requireAvailable(): Promise<ComposioApiClient> {
    const apiClient = await this.getApiClient();

    if (!apiClient) {
      throw new NakamaApiError("Composio is not configured on this deployment.", 503);
    }

    return apiClient;
  }

  private async getOwnedToolkit(orgId: string, toolkitId: string): Promise<StoredComposioToolkitRecord> {
    const record = await this.databaseAdapter.getComposioToolkit(toolkitId);
    if (!record || record.orgId !== orgId) {
      throw new NakamaApiError("Composio toolkit not found.", 404);
    }

    return record;
  }

  private async getOwnedToolkitBySlug(
    orgId: string,
    toolkitSlug: string,
  ): Promise<StoredComposioToolkitRecord> {
    const record = await this.databaseAdapter.getComposioToolkitBySlug(orgId, toolkitSlug);
    if (!record) {
      throw new NakamaApiError("Composio toolkit not found.", 404);
    }

    return record;
  }

  private assertProfileOrg(profile: StoredProfileRecord, orgId: string): void {
    if (profile.orgId !== orgId) {
      throw new NakamaApiError("Profile not found for this organization.", 404);
    }
  }
}
