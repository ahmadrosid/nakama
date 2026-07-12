import {
  composioUserId,
  createId,
  isComposioConfiguredAsync,
  loadComposioConfigFile,
  NakamaApiError,
  nanoid,
  resolveComposioApiKey,
  type ComposioCatalogToolkitSummary,
  type ComposioConnectResponse,
  type ComposioToolkitSummary,
  type ComposioUserConnectionSummary,
  type ListComposioToolkitsResponse,
  type ListProfileComposioToolkitsResponse,
  type ProfileComposioToolkitAssignment,
  type UpdateProfileComposioToolkitsRequest,
} from "@nakama/core";
import { normalizeEnableComposioToolkitRequest, normalizeUpdateProfileComposioToolkitsRequest } from "@nakama/core";
import type {
  DatabaseAdapter,
  StoredComposioToolkitRecord,
  StoredComposioUserConnectionRecord,
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
  userId: string;
  toolkitId: string;
  connectionId: string;
  nonce: string;
}

function toOrgToolkitSummary(record: StoredComposioToolkitRecord): ComposioToolkitSummary {
  return {
    id: record.id,
    toolkitSlug: record.toolkitSlug,
    displayName: record.displayName,
    status: record.status,
    cachedTools: record.cachedTools,
    lastError: record.lastError,
    updatedAt: record.updatedAt,
  };
}

function toUserConnectionSummary(
  connection: StoredComposioUserConnectionRecord,
  toolkitSlug: string,
): ComposioUserConnectionSummary {
  return {
    id: connection.id,
    toolkitId: connection.toolkitId,
    toolkitSlug,
    status: connection.status,
    lastError: connection.lastError,
    updatedAt: connection.updatedAt,
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
    return this.isReachable();
  }

  async isReachable(): Promise<boolean> {
    const apiClient = await this.getApiClient();
    if (!apiClient) {
      return false;
    }

    try {
      await apiClient.listCatalogToolkits();
      return true;
    } catch {
      return false;
    }
  }

  async validateConfiguration(apiKey?: string): Promise<void> {
    const resolvedKey = apiKey?.trim() || (await this.resolveApiKey());
    if (!resolvedKey) {
      throw new NakamaApiError("Composio API key is required.", 400);
    }

    const client = createComposioApiClient(resolvedKey);
    if (!client) {
      throw new NakamaApiError("Composio API key is required.", 400);
    }

    try {
      await client.listCatalogToolkits();
    } catch (error) {
      throw new NakamaApiError(
        error instanceof Error ? error.message : "Failed to validate Composio API key.",
        400,
      );
    }
  }

  async listToolkits(orgId: string, userId: string): Promise<ListComposioToolkitsResponse> {
    const configured = await isComposioConfiguredAsync();
    const orgToolkits = (await this.databaseAdapter.listComposioToolkitsForOrg(orgId)).map(
      toOrgToolkitSummary,
    );
    const toolkitSlugById = new Map(
      orgToolkits.map((toolkit) => [toolkit.id, toolkit.toolkitSlug] as const),
    );
    const userConnectionRecords = await this.databaseAdapter.listComposioUserConnectionsForUser(
      orgId,
      userId,
    );
    const userConnections = userConnectionRecords
      .map((connection) => {
        const toolkitSlug = toolkitSlugById.get(connection.toolkitId);
        return toolkitSlug ? toUserConnectionSummary(connection, toolkitSlug) : null;
      })
      .filter((connection): connection is ComposioUserConnectionSummary => connection !== null);

    if (!configured) {
      return {
        configured: false,
        composioReachable: false,
        composioAvailable: false,
        catalog: [],
        orgToolkits,
        userConnections,
        catalogError: null,
      };
    }

    const apiClient = await this.getApiClient();
    if (!apiClient) {
      return {
        configured: false,
        composioReachable: false,
        composioAvailable: false,
        catalog: [],
        orgToolkits,
        userConnections,
        catalogError: null,
      };
    }

    try {
      const remoteCatalog = await apiClient.listCatalogToolkits();
      const catalog: ComposioCatalogToolkitSummary[] = remoteCatalog.map((toolkit) => ({
        slug: toolkit.slug,
        name: toolkit.name,
        description: toolkit.description,
        logoUrl: toolkit.logoUrl,
      }));

      return {
        configured: true,
        composioReachable: true,
        composioAvailable: true,
        catalog,
        orgToolkits,
        userConnections,
        catalogError: null,
      };
    } catch (error) {
      const catalogError =
        error instanceof Error ? error.message : "Failed to load Composio toolkit catalog.";

      return {
        configured: true,
        composioReachable: false,
        composioAvailable: false,
        catalog: [],
        orgToolkits,
        userConnections,
        catalogError,
      };
    }
  }

  async enableToolkit(orgId: string, input: unknown): Promise<ComposioToolkitSummary> {
    await this.requireAvailable();
    const request = normalizeEnableComposioToolkitRequest(input);
    const existing = await this.databaseAdapter.getComposioToolkitBySlug(orgId, request.toolkitSlug);
    const now = new Date().toISOString();

    if (existing) {
      const updated: StoredComposioToolkitRecord = {
        ...existing,
        status: "enabled",
        lastError: null,
        updatedAt: now,
      };
      await this.databaseAdapter.upsertComposioToolkit(updated);
      return toOrgToolkitSummary(updated);
    }

    const record: StoredComposioToolkitRecord = {
      id: createId("ctk"),
      orgId,
      toolkitSlug: request.toolkitSlug,
      displayName: titleCaseToolkit(request.toolkitSlug),
      status: "enabled",
      cachedTools: [],
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.databaseAdapter.upsertComposioToolkit(record);
    return toOrgToolkitSummary(record);
  }

  async disableToolkit(orgId: string, toolkitSlug: string): Promise<ComposioToolkitSummary> {
    const record = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);
    const updated: StoredComposioToolkitRecord = {
      ...record,
      status: "disabled",
      updatedAt: new Date().toISOString(),
    };
    await this.databaseAdapter.upsertComposioToolkit(updated);
    return toOrgToolkitSummary(updated);
  }

  async connectToolkit(
    orgId: string,
    userId: string,
    toolkitSlug: string,
    callbackBaseUrl: string,
  ): Promise<ComposioConnectResponse> {
    const apiClient = await this.requireAvailable();
    const orgToolkit = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);

    if (orgToolkit.status !== "enabled") {
      throw new NakamaApiError("An org admin must enable this toolkit before you can connect.", 400);
    }

    const now = new Date().toISOString();
    const existingConnection = await this.databaseAdapter.getComposioUserConnection(
      userId,
      orgToolkit.id,
    );
    const connectionId = existingConnection?.id ?? createId("cuc");
    const oauthNonce = nanoid(32);
    const state = Buffer.from(
      JSON.stringify({
        orgId,
        userId,
        toolkitId: orgToolkit.id,
        connectionId,
        nonce: oauthNonce,
      } satisfies ComposioOAuthStatePayload),
    ).toString("base64url");
    const callbackUrl = `${callbackBaseUrl.replace(/\/$/, "")}/v1/composio/oauth/callback?state=${encodeURIComponent(state)}`;
    const link = await apiClient.linkToolkitAccount(
      composioUserId(userId),
      toolkitSlug,
      callbackUrl,
    );

    const connection: StoredComposioUserConnectionRecord = {
      id: connectionId,
      orgId,
      userId,
      toolkitId: orgToolkit.id,
      status: "oauth_in_progress",
      connectedAccountId: link.connectedAccountId ?? existingConnection?.connectedAccountId ?? null,
      sessionIdEnc: null,
      oauthStateHash: this.authService.hashToken(oauthNonce),
      lastError: null,
      createdAt: existingConnection?.createdAt ?? now,
      updatedAt: now,
    };

    await this.databaseAdapter.upsertComposioUserConnection(connection);

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

    const orgToolkit = await this.getOwnedToolkit(payload.orgId, payload.toolkitId);
    const connection = await this.databaseAdapter.getComposioUserConnectionById(payload.connectionId);

    if (
      !connection ||
      connection.orgId !== payload.orgId ||
      connection.userId !== payload.userId ||
      connection.toolkitId !== payload.toolkitId
    ) {
      throw new NakamaApiError("Invalid OAuth state.", 400);
    }

    if (
      !connection.oauthStateHash ||
      this.authService.hashToken(payload.nonce) !== connection.oauthStateHash
    ) {
      throw new NakamaApiError("Invalid OAuth state.", 400);
    }

    const updatedConnection: StoredComposioUserConnectionRecord = {
      ...connection,
      status: "connected",
      oauthStateHash: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };

    await this.databaseAdapter.upsertComposioUserConnection(updatedConnection);
    await this.syncUserToolkit(payload.orgId, payload.userId, orgToolkit.toolkitSlug);

    return { orgId: payload.orgId, toolkitSlug: orgToolkit.toolkitSlug };
  }

  async disconnectToolkit(
    orgId: string,
    userId: string,
    toolkitSlug: string,
  ): Promise<ComposioToolkitSummary> {
    const apiClient = await this.requireAvailable();
    const orgToolkit = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);
    const connection = await this.databaseAdapter.getComposioUserConnection(userId, orgToolkit.id);

    if (!connection) {
      return toOrgToolkitSummary(orgToolkit);
    }

    if (connection.connectedAccountId) {
      try {
        await apiClient.deleteConnectedAccount(connection.connectedAccountId);
      } catch {
        // Best-effort remote revoke.
      }
    }

    await this.databaseAdapter.deleteComposioUserConnection(connection.id);

    return toOrgToolkitSummary(orgToolkit);
  }

  async syncUserToolkit(
    orgId: string,
    userId: string,
    toolkitSlug: string,
  ): Promise<ComposioToolkitSummary> {
    const apiClient = await this.requireAvailable();
    const orgToolkit = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);
    const connection = await this.databaseAdapter.getComposioUserConnection(userId, orgToolkit.id);

    if (!connection || connection.status !== "connected") {
      throw new NakamaApiError("Connect the toolkit before syncing tools.", 400);
    }

    try {
      const session = await this.openUserSession(userId, [orgToolkit.toolkitSlug], {
        [orgToolkit.toolkitSlug]: null,
      });
      const cachedTools = await apiClient.listSessionTools(session);
      const updatedOrgToolkit: StoredComposioToolkitRecord = {
        ...orgToolkit,
        cachedTools,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
      const updatedConnection: StoredComposioUserConnectionRecord = {
        ...connection,
        sessionIdEnc: await this.encryptSessionId(session.sessionId),
        lastError: null,
        updatedAt: new Date().toISOString(),
      };

      await this.databaseAdapter.upsertComposioToolkit(updatedOrgToolkit);
      await this.databaseAdapter.upsertComposioUserConnection(updatedConnection);
      return toOrgToolkitSummary(updatedOrgToolkit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updatedConnection: StoredComposioUserConnectionRecord = {
        ...connection,
        lastError: message,
        updatedAt: new Date().toISOString(),
      };
      await this.databaseAdapter.upsertComposioUserConnection(updatedConnection);
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
    userId: string,
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
    const userConnections = await this.databaseAdapter.listComposioUserConnectionsForUser(
      orgId,
      userId,
    );
    const connectionByToolkitId = new Map(
      userConnections.map((connection) => [connection.toolkitId, connection] as const),
    );

    for (const assignment of assignments) {
      const toolkit = toolkitById.get(assignment.toolkitId);
      const connection = connectionByToolkitId.get(assignment.toolkitId);
      if (!toolkit || toolkit.status !== "enabled" || connection?.status !== "connected") {
        continue;
      }

      enabledToolkits.push(toolkit.toolkitSlug);
      allowedToolsByToolkit[toolkit.toolkitSlug] = assignment.allowedActions;
    }

    if (enabledToolkits.length === 0) {
      return null;
    }

    const existingSessionId = await this.readExistingSessionId(userConnections, enabledToolkits, orgToolkits);

    if (existingSessionId) {
      return apiClient.reuseProfileSession(
        existingSessionId,
        enabledToolkits,
        allowedToolsByToolkit,
      );
    }

    return apiClient.createProfileSession(
      composioUserId(userId),
      enabledToolkits,
      allowedToolsByToolkit,
    );
  }

  async formatProfileConnectionsContext(
    orgId: string,
    userId: string,
    profileId: string,
  ): Promise<string> {
    if (!(await this.isAvailable())) {
      return "";
    }

    const assigned = await this.getAssignedToolkitRecords(orgId, userId, profileId);
    if (assigned.length === 0) {
      return "";
    }

    const lines = assigned.map(({ orgToolkit, userConnection, allowedActions }) => {
      const toolCount = orgToolkit.cachedTools.length;
      const toolsSuffix = toolCount > 0 ? `, ${toolCount} tool${toolCount === 1 ? "" : "s"}` : "";
      const actionsSuffix =
        allowedActions && allowedActions.length > 0
          ? ` (allowed actions: ${allowedActions.join(", ")})`
          : "";
      const connectionStatus = userConnection?.status ?? "not_connected";

      return `- ${orgToolkit.displayName} (\`${orgToolkit.toolkitSlug}\`): org ${orgToolkit.status}, your connection ${connectionStatus}${toolsSuffix}${actionsSuffix}`;
    });

    return [
      "## Composio integrations",
      "",
      "Assigned SaaS toolkits for this profile (your personal connections):",
      ...lines,
      "",
      "Use assigned Composio tools for external SaaS actions. If your connection is missing, open Integrations → Composio to connect — never self-authorize OAuth in chat.",
    ].join("\n");
  }

  async getAssignedToolkitRecords(
    orgId: string,
    userId: string,
    profileId: string,
  ): Promise<
    Array<{
      orgToolkit: StoredComposioToolkitRecord;
      userConnection: StoredComposioUserConnectionRecord | null;
      allowedActions: string[] | null;
    }>
  > {
    const assignments = await this.databaseAdapter.listProfileComposioToolkits(profileId);
    const orgToolkits = await this.databaseAdapter.listComposioToolkitsForOrg(orgId);
    const toolkitById = new Map(orgToolkits.map((toolkit) => [toolkit.id, toolkit]));
    const userConnections = await this.databaseAdapter.listComposioUserConnectionsForUser(
      orgId,
      userId,
    );
    const connectionByToolkitId = new Map(
      userConnections.map((connection) => [connection.toolkitId, connection] as const),
    );

    return assignments
      .map((assignment) => {
        const orgToolkit = toolkitById.get(assignment.toolkitId);
        if (!orgToolkit) {
          return null;
        }

        return {
          orgToolkit,
          userConnection: connectionByToolkitId.get(assignment.toolkitId) ?? null,
          allowedActions: assignment.allowedActions,
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          orgToolkit: StoredComposioToolkitRecord;
          userConnection: StoredComposioUserConnectionRecord | null;
          allowedActions: string[] | null;
        } => entry !== null,
      );
  }

  private async openUserSession(
    userId: string,
    toolkitSlugs: string[],
    allowedToolsByToolkit: Record<string, string[] | null>,
  ): Promise<ComposioSessionMcpEndpoint> {
    const apiClient = await this.requireAvailable();
    return apiClient.createProfileSession(
      composioUserId(userId),
      toolkitSlugs,
      allowedToolsByToolkit,
    );
  }

  private async readExistingSessionId(
    userConnections: StoredComposioUserConnectionRecord[],
    enabledToolkits: string[],
    orgToolkits: StoredComposioToolkitRecord[],
  ): Promise<string | null> {
    const secret = await this.resolveApiKey();
    if (!secret) {
      return null;
    }

    const slugByToolkitId = new Map(orgToolkits.map((toolkit) => [toolkit.id, toolkit.toolkitSlug]));
    const enabled = new Set(enabledToolkits);

    for (const connection of userConnections) {
      const slug = slugByToolkitId.get(connection.toolkitId);
      if (!slug || !enabled.has(slug) || !connection.sessionIdEnc) {
        continue;
      }

      try {
        return decryptComposioSecret(connection.sessionIdEnc, secret);
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
