import { createCipheriv, createHash, randomBytes } from "node:crypto";
import {
  type ComposioCatalogToolkitSummary,
  type ComposioConnectResponse,
  type ComposioToolkitSummary,
  type ComposioUserConnectionSummary,
  composioUserId,
  createId,
  type EnableComposioToolkitRequest,
  isComposioConfiguredAsync,
  type ListComposioToolkitsResponse,
  type ListProfileComposioToolkitsResponse,
  loadComposioConfigFile,
  NakamaApiError,
  nanoid,
  normalizeEnableComposioToolkitRequest,
  normalizeUpdateProfileComposioToolkitsRequest,
  type ProfileComposioToolkitAssignment,
  resolveComposioApiKey,
  type UpdateProfileComposioToolkitsRequest,
} from "@nakama/core";
import type { MeetActionResults } from "@nakama/core/google-meet";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import type {
  DatabaseAdapter,
  StoredComposioToolkitRecord,
  StoredComposioUserConnectionRecord,
  StoredProfileComposioToolkitRecord,
  StoredProfileRecord,
} from "@nakama/db";
import { z } from "zod";
import type { AuthService } from "./auth-service";
import {
  ComposioApiClient,
  type ComposioSessionMcpEndpoint,
  findRejectedConnectedAccountIds,
} from "./composio-api-client";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(`nakama-composio:${secret}`).digest();
}

function encryptComposioSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

interface ComposioOAuthStatePayload {
  connectionId: string;
  nonce: string;
  orgId: string;
  returnTo?: string;
  toolkitId: string;
  userId: string;
}

const STALE_CONNECTION_ERROR =
  "Composio no longer has this account. Connect the app again.";

const MEET_RECORDING_TOOLKITS = new Set(["gmail", "googledrive"]);

const MEET_RETURN_PATH = "/google-meet?import=recording";

/**
 * A path on this site, never another origin: the OAuth callback redirects to
 * it, so `//evil.example` or `/\\evil.example` would be an open redirect.
 */
export function isSameSiteReturnPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return false;
  }

  try {
    return (
      new URL(path, "http://nakama.local").origin === "http://nakama.local"
    );
  } catch {
    return false;
  }
}

function toOrgToolkitSummary(
  record: StoredComposioToolkitRecord
): ComposioToolkitSummary {
  return {
    cachedTools: record.cachedTools,
    displayName: record.displayName,
    id: record.id,
    lastError: record.lastError,
    status: record.status,
    toolkitSlug: record.toolkitSlug,
    updatedAt: record.updatedAt,
  };
}

function toUserConnectionSummary(
  connection: StoredComposioUserConnectionRecord,
  toolkitSlug: string
): ComposioUserConnectionSummary {
  return {
    id: connection.id,
    lastError: connection.lastError,
    status: connection.status,
    toolkitId: connection.toolkitId,
    toolkitSlug,
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
  private static readonly REACHABILITY_TTL_MS = 30_000;

  private apiClientCache: { key: string; client: ComposioApiClient } | null =
    null;
  private reachabilityCache: { value: boolean; expiresAt: number } | null =
    null;
  private reachabilityInflight: Promise<boolean> | null = null;
  private readonly profileSessionCache = new Map<
    string,
    { fingerprint: string; endpoint: ComposioSessionMcpEndpoint }
  >();
  /** Why the last profile session failed to open, by session cache key. */
  private readonly profileSessionErrors = new Map<string, string>();

  /** Goes up when the Composio configuration changes, for every org. */
  private configRevision = 0;
  /** Goes up on a toolkit, connection, or assignment change in one org. */
  private readonly orgRevisions = new Map<string, number>();

  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService
  ) {}

  private async googleAccounts(orgId: string, userId: string) {
    const actingUserId = await this.resolveComposioActingUserId(orgId, userId);

    const toolkits =
      await this.databaseAdapter.listComposioToolkitsForOrg(orgId);

    const connections =
      await this.databaseAdapter.listComposioUserConnectionsForUser(
        orgId,
        actingUserId
      );

    const account = (slug: string) => {
      const toolkit = toolkits.find(
        (item) => item.toolkitSlug === slug && item.status === "enabled"
      );

      const connection = connections.find(
        (item) => item.toolkitId === toolkit?.id && item.status === "connected"
      );

      return connection?.connectedAccountId ?? null;
    };

    return {
      actingUserId: composioUserId(actingUserId),
      drive: account("googledrive"),
      gmail: account("gmail"),
      sheets: account("googlesheets"),
    };
  }

  /** Runs one Google Sheets tool on the caller's own connected account. */
  async executeGoogleSheetsTool(
    orgId: string,
    userId: string,
    slug: string,
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Composio tool payloads are untyped JSON objects.
    args: Record<string, unknown>
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- Composio tool payloads are untyped JSON passed through to the caller.
  ): Promise<unknown> {
    const client = await this.getApiClient();
    const accounts = await this.googleAccounts(orgId, userId);

    if (!(client && accounts.sheets)) {
      throw new Error("Connect Google Sheets in Composio first.");
    }

    return unwrapMeetToolResult(
      await client.executeTool(
        slug,
        accounts.actingUserId,
        accounts.sheets,
        args
      )
    );
  }

  async listMeetRecordings(orgId: string, userId: string) {
    const client = await this.getApiClient();

    if (!client) {
      return {
        composioConfigured: false,
        driveConnected: false,
        gmailConnected: false,
        recordings: [],
      };
    }

    const accounts = await this.googleAccounts(orgId, userId);

    if (!(accounts.gmail && accounts.drive)) {
      return {
        composioConfigured: true,
        driveConnected: !!accounts.drive,
        gmailConnected: !!accounts.gmail,
        recordings: [],
      };
    }

    const result = unwrapMeetToolResult(
      await client.executeTool(
        "GMAIL_FETCH_EMAILS",
        accounts.actingUserId,
        accounts.gmail,
        {
          include_payload: true,
          max_results: 10,
          query:
            'subject:("Meeting records" OR "Meeting recording" OR "Meet Recording")',
          verbose: true,
        }
      )
    );

    const messages = findMeetMessages(result).slice(0, 10);
    const recordings: MeetActionResults["recordings"]["recordings"] = [];
    const seen = new Set<string>();

    for (const message of messages) {
      const messageId = meetString(message.messageId ?? message.id);

      if (!messageId) {
        continue;
      }

      let full: unknown;

      try {
        full = unwrapMeetToolResult(
          await client.executeTool(
            "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
            accounts.actingUserId,
            accounts.gmail,
            { format: "full", message_id: messageId }
          )
        );
      } catch {
        continue;
      }

      for (const fileId of extractMeetDriveIds(full)) {
        if (seen.has(fileId)) {
          continue;
        }

        seen.add(fileId);
        // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Composio tool payloads are untyped JSON objects.
        let metadata: Record<string, unknown>;

        try {
          const value = unwrapMeetToolResult(
            await client.executeTool(
              "GOOGLEDRIVE_GET_FILE_METADATA",
              accounts.actingUserId,
              accounts.drive,
              { fields: "id,name,mimeType,size", fileId }
            )
          );

          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Composio tool payloads are untyped JSON narrowed here by shape.
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            continue;
          }

          // SAFETY: The surrounding code checked this value before the assertion.
          // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Composio tool payloads are untyped JSON objects.
          metadata = value as Record<string, unknown>;
        } catch {
          continue;
        }

        const name = meetString(metadata.name ?? metadata.title);
        const mimeType = meetString(metadata.mimeType);
        const size = metadata.size == null ? 0 : Number(metadata.size);

        if (
          !(
            name &&
            name.length <= 255 &&
            !/[\\/\x00-\x1f]/.test(name) &&
            (mimeType.startsWith("video/") ||
              /\.(mp4|mov|webm|mkv|m4v)$/i.test(name)) &&
            Number.isSafeInteger(size) &&
            size >= 0
          )
        ) {
          continue;
        }

        recordings.push({
          date: meetString(
            message.messageTimestamp ?? message.internalDate ?? message.date
          ),
          fileId,
          messageId,
          name,
          size,
        });
      }
    }

    return {
      composioConfigured: true,
      driveConnected: true,
      gmailConnected: true,
      recordings,
    };
  }

  async downloadMeetRecording(
    orgId: string,
    userId: string,
    messageId: string,
    fileId: string
  ) {
    const listed = await this.listMeetRecordings(orgId, userId);

    const recording = listed.recordings.find(
      (item) => item.messageId === messageId && item.fileId === fileId
    );

    if (!recording) {
      throw new NakamaApiError(
        "Recording not found in your connected accounts.",
        404
      );
    }

    if (recording.size > 1024 ** 3) {
      throw new NakamaApiError("Recording is larger than 1 GiB.", 400);
    }

    const accounts = await this.googleAccounts(orgId, userId);
    const client = await this.getApiClient();

    if (!(client && accounts.drive)) {
      throw new NakamaApiError("Google Drive is not connected.", 400);
    }

    const result = unwrapMeetToolResult(
      await client.executeTool(
        "GOOGLEDRIVE_DOWNLOAD_FILE",
        accounts.actingUserId,
        accounts.drive,
        {
          file_id: fileId,
        }
      )
    );

    return { file: result, recording };
  }

  reloadConfiguration(): void {
    this.apiClientCache = null;
    this.reachabilityCache = null;
    this.reachabilityInflight = null;
    this.profileSessionCache.clear();
    this.configRevision += 1;
  }

  /**
   * Chats hold their Composio tools, so the agent rebuilds a chat when this
   * changes. A change in one org does not rebuild the chats of other orgs.
   */
  revisionFor(orgId: string): string {
    return `${this.configRevision}:${this.orgRevisions.get(orgId) ?? 0}`;
  }

  private bumpRevision(orgId: string): void {
    this.orgRevisions.set(orgId, (this.orgRevisions.get(orgId) ?? 0) + 1);
  }

  /**
   * Channel bridges (Telegram / WhatsApp / Discord / CLI) authenticate as the
   * local client user. Composio OAuth is per human member, so map the local
   * client onto the earliest human org admin — same convention as the legacy
   * org-shared connection migration.
   */
  async resolveComposioActingUserId(
    orgId: string,
    userId: string
  ): Promise<string> {
    if (userId !== LOCAL_CLIENT_USER_ID) {
      return userId;
    }

    const members = await this.databaseAdapter.listOrgMembers(orgId);

    const humanAdmins = members
      .filter(
        (member) =>
          member.role === "admin" && member.userId !== LOCAL_CLIENT_USER_ID
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return humanAdmins[0]?.userId ?? userId;
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

    const client = new ComposioApiClient(apiKey);

    this.apiClientCache = { client, key: apiKey };

    return client;
  }

  async isAvailable(): Promise<boolean> {
    return this.isReachable();
  }

  async isReachable(): Promise<boolean> {
    const cached = this.reachabilityCache;
    const now = Date.now();

    if (cached) {
      if (cached.expiresAt > now) {
        return cached.value;
      }

      // Stale-while-revalidate: status polls every 10s — never block on a warm cache.
      if (!this.reachabilityInflight) {
        this.reachabilityInflight = this.probeReachability().finally(() => {
          this.reachabilityInflight = null;
        });
      }

      return cached.value;
    }

    if (this.reachabilityInflight) {
      return this.reachabilityInflight;
    }

    this.reachabilityInflight = this.probeReachability().finally(() => {
      this.reachabilityInflight = null;
    });

    return this.reachabilityInflight;
  }

  private async probeReachability(): Promise<boolean> {
    const apiClient = await this.getApiClient();

    if (!apiClient) {
      this.cacheReachability(false);

      return false;
    }

    try {
      // Limit 1: reachability only — full catalog fetch is ~1s and used by listToolkits.
      await apiClient.listCatalogToolkits({ limit: 1 });
      this.cacheReachability(true);

      return true;
    } catch {
      this.cacheReachability(false);

      return false;
    }
  }

  private cacheReachability(value: boolean): void {
    this.reachabilityCache = {
      expiresAt: Date.now() + ComposioService.REACHABILITY_TTL_MS,
      value,
    };
  }

  async validateConfiguration(apiKey?: string): Promise<void> {
    const resolvedKey = apiKey?.trim() || (await this.resolveApiKey());

    if (!resolvedKey) {
      throw new NakamaApiError("Composio API key is required.", 400);
    }

    const client = new ComposioApiClient(resolvedKey);

    try {
      await client.listCatalogToolkits({ limit: 1 });
    } catch (error) {
      throw new NakamaApiError(
        error instanceof Error
          ? error.message
          : "Failed to validate Composio API key.",
        400
      );
    }
  }

  async listToolkits(
    orgId: string,
    userId: string
  ): Promise<ListComposioToolkitsResponse> {
    const configured = await isComposioConfiguredAsync();

    const orgToolkits = (
      await this.databaseAdapter.listComposioToolkitsForOrg(orgId)
    ).map(toOrgToolkitSummary);

    const toolkitSlugById = new Map(
      orgToolkits.map((toolkit) => [toolkit.id, toolkit.toolkitSlug] as const)
    );

    const userConnectionRecords =
      await this.databaseAdapter.listComposioUserConnectionsForUser(
        orgId,
        userId
      );

    const userConnections = userConnectionRecords
      .map((connection) => {
        const toolkitSlug = toolkitSlugById.get(connection.toolkitId);

        return toolkitSlug
          ? toUserConnectionSummary(connection, toolkitSlug)
          : null;
      })
      .filter(
        (connection): connection is ComposioUserConnectionSummary =>
          connection !== null
      );

    if (!configured) {
      return {
        catalog: [],
        catalogError: null,
        composioAvailable: false,
        composioReachable: false,
        configured: false,
        orgToolkits,
        userConnections,
      };
    }

    const apiClient = await this.getApiClient();

    if (!apiClient) {
      return {
        catalog: [],
        catalogError: null,
        composioAvailable: false,
        composioReachable: false,
        configured: false,
        orgToolkits,
        userConnections,
      };
    }

    try {
      const remoteCatalog = await apiClient.listCatalogToolkits();

      const catalog: ComposioCatalogToolkitSummary[] = remoteCatalog.map(
        (toolkit) => ({
          description: toolkit.description,
          logoUrl: toolkit.logoUrl,
          name: toolkit.name,
          slug: toolkit.slug,
        })
      );

      return {
        catalog,
        catalogError: null,
        composioAvailable: true,
        composioReachable: true,
        configured: true,
        orgToolkits,
        userConnections,
      };
    } catch (error) {
      const catalogError =
        error instanceof Error
          ? error.message
          : "Failed to load Composio toolkit catalog.";

      return {
        catalog: [],
        catalogError,
        composioAvailable: false,
        composioReachable: false,
        configured: true,
        orgToolkits,
        userConnections,
      };
    }
  }

  async enableToolkit(
    orgId: string,
    input: EnableComposioToolkitRequest
  ): Promise<ComposioToolkitSummary> {
    await this.requireAvailable();
    const request = normalizeEnableComposioToolkitRequest(input);

    const existing = await this.databaseAdapter.getComposioToolkitBySlug(
      orgId,
      request.toolkitSlug
    );

    const now = new Date().toISOString();

    if (existing) {
      const updated: StoredComposioToolkitRecord = {
        ...existing,
        lastError: null,
        status: "enabled",
        updatedAt: now,
      };

      await this.databaseAdapter.upsertComposioToolkit(updated);
      await this.assignToDefaultProfile(orgId, updated.id);
      this.bumpRevision(orgId);

      return toOrgToolkitSummary(updated);
    }

    const record: StoredComposioToolkitRecord = {
      cachedTools: [],
      createdAt: now,
      displayName: titleCaseToolkit(request.toolkitSlug),
      id: createId("ctk"),
      lastError: null,
      orgId,
      status: "enabled",
      toolkitSlug: request.toolkitSlug,
      updatedAt: now,
    };

    await this.databaseAdapter.upsertComposioToolkit(record);
    await this.assignToDefaultProfile(orgId, record.id);
    this.bumpRevision(orgId);

    return toOrgToolkitSummary(record);
  }

  async disableToolkit(
    orgId: string,
    toolkitSlug: string
  ): Promise<ComposioToolkitSummary> {
    const record = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);

    const updated: StoredComposioToolkitRecord = {
      ...record,
      status: "disabled",
      updatedAt: new Date().toISOString(),
    };

    await this.databaseAdapter.upsertComposioToolkit(updated);
    await this.unassignFromAllProfiles(orgId, updated.id);
    this.bumpRevision(orgId);

    return toOrgToolkitSummary(updated);
  }

  /**
   * Enabling a toolkit assigns it to the org's default profile, so a fresh
   * setup is usable without a second trip to Profiles. Other profiles stay an
   * explicit choice: Super Nakama and channel-facing profiles should not gain a
   * member's Gmail because an admin enabled it for the org.
   */
  private async assignToDefaultProfile(
    orgId: string,
    toolkitId: string
  ): Promise<void> {
    const profiles = await this.databaseAdapter.listProfiles();

    const target = profiles.find(
      (profile) => profile.orgId === orgId && profile.isDefault === true
    );

    if (
      !target ||
      (await this.databaseAdapter.getSharedAgentInstance(orgId, target.id))
    ) {
      return;
    }

    const assignments = await this.databaseAdapter.listProfileComposioToolkits(
      target.id
    );

    if (assignments.some((entry) => entry.toolkitId === toolkitId)) {
      return;
    }

    await this.databaseAdapter.replaceProfileComposioToolkits(target.id, [
      ...assignments,
      { allowedActions: null, profileId: target.id, toolkitId },
    ]);
  }

  /**
   * Disabling for the org removes the toolkit from every profile. The tool
   * bridge already skips disabled toolkits, so this is about the Profiles page
   * not listing a toolkit that does nothing.
   */
  private async unassignFromAllProfiles(
    orgId: string,
    toolkitId: string
  ): Promise<void> {
    const profiles = await this.databaseAdapter.listProfiles();

    for (const profile of profiles) {
      if (profile.orgId !== orgId) {
        continue;
      }

      const assignments =
        await this.databaseAdapter.listProfileComposioToolkits(profile.id);

      const kept = assignments.filter((entry) => entry.toolkitId !== toolkitId);

      if (kept.length === assignments.length) {
        continue;
      }

      await this.databaseAdapter.replaceProfileComposioToolkits(
        profile.id,
        kept
      );
    }
  }

  /**
   * Meet's Import recording needs Gmail and Google Drive. One click enables the
   * toolkit for the org when needed, then starts the member's OAuth, which
   * returns to the Google Meet page instead of Integrations.
   */
  async connectMeetRecordingSource(
    orgId: string,
    userId: string,
    toolkitSlug: string,
    callbackBaseUrl: string
  ): Promise<ComposioConnectResponse> {
    if (!MEET_RECORDING_TOOLKITS.has(toolkitSlug)) {
      throw new NakamaApiError("Unsupported recording source.", 400);
    }

    const existing = await this.databaseAdapter.getComposioToolkitBySlug(
      orgId,
      toolkitSlug
    );

    if (existing?.status !== "enabled") {
      await this.enableToolkit(orgId, { toolkitSlug });
    }

    return this.connectToolkit(orgId, userId, toolkitSlug, callbackBaseUrl, {
      returnTo: MEET_RETURN_PATH,
    });
  }

  async connectToolkit(
    orgId: string,
    userId: string,
    toolkitSlug: string,
    callbackBaseUrl: string,
    options: { returnTo?: string } = {}
  ): Promise<ComposioConnectResponse> {
    const actingUserId = await this.resolveComposioActingUserId(orgId, userId);
    const apiClient = await this.requireAvailable();
    const orgToolkit = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);

    if (orgToolkit.status !== "enabled") {
      throw new NakamaApiError(
        "An org admin must enable this toolkit before you can connect.",
        400
      );
    }

    const now = new Date().toISOString();

    const existingConnection =
      await this.databaseAdapter.getComposioUserConnection(
        actingUserId,
        orgToolkit.id
      );

    const connectionId = existingConnection?.id ?? createId("cuc");
    const oauthNonce = nanoid(32);

    const state = Buffer.from(
      JSON.stringify({
        connectionId,
        nonce: oauthNonce,
        orgId,
        returnTo: options.returnTo,
        toolkitId: orgToolkit.id,
        userId: actingUserId,
      } satisfies ComposioOAuthStatePayload)
    ).toString("base64url");

    const callbackUrl = `${callbackBaseUrl.replace(/\/$/, "")}/v1/composio/oauth/callback?state=${encodeURIComponent(state)}`;

    const link = await apiClient.linkToolkitAccount(
      composioUserId(actingUserId),
      toolkitSlug,
      callbackUrl
    );

    const connection: StoredComposioUserConnectionRecord = {
      connectedAccountId:
        link.connectedAccountId ??
        existingConnection?.connectedAccountId ??
        null,
      createdAt: existingConnection?.createdAt ?? now,
      id: connectionId,
      lastError: null,
      oauthStateHash: this.authService.hashToken(oauthNonce),
      orgId,
      sessionIdEnc: null,
      status: "oauth_in_progress",
      toolkitId: orgToolkit.id,
      updatedAt: now,
      userId: actingUserId,
    };

    await this.databaseAdapter.upsertComposioUserConnection(connection);

    return { redirectUrl: link.redirectUrl };
  }

  async completeOAuth(
    state: string,
    options: { connectedAccountId?: string | null } = {}
  ): Promise<{ orgId: string; returnTo?: string; toolkitSlug: string }> {
    await this.requireAvailable();

    let payload: ComposioOAuthStatePayload;

    try {
      payload = z
        .object({
          connectionId: z.string(),
          nonce: z.string(),
          orgId: z.string(),
          returnTo: z.string().refine(isSameSiteReturnPath).optional(),
          toolkitId: z.string(),
          userId: z.string(),
        })
        .parse(JSON.parse(Buffer.from(state, "base64url").toString("utf8")));
    } catch {
      throw new NakamaApiError("Invalid OAuth state.", 400);
    }

    const orgToolkit = await this.getOwnedToolkit(
      payload.orgId,
      payload.toolkitId
    );

    const connection = await this.databaseAdapter.getComposioUserConnectionById(
      payload.connectionId
    );

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

    const connectedAccountId =
      options.connectedAccountId?.trim() ||
      connection.connectedAccountId ||
      null;

    const updatedConnection: StoredComposioUserConnectionRecord = {
      ...connection,
      connectedAccountId,
      lastError: null,
      oauthStateHash: null,
      status: "connected",
      updatedAt: new Date().toISOString(),
    };

    await this.databaseAdapter.upsertComposioUserConnection(updatedConnection);
    this.invalidateProfileSessionCachesForUser(payload.orgId, payload.userId);
    await this.syncUserToolkit(
      payload.orgId,
      payload.userId,
      orgToolkit.toolkitSlug
    );

    return {
      orgId: payload.orgId,
      returnTo: payload.returnTo,
      toolkitSlug: orgToolkit.toolkitSlug,
    };
  }

  async disconnectToolkit(
    orgId: string,
    userId: string,
    toolkitSlug: string
  ): Promise<ComposioToolkitSummary> {
    const actingUserId = await this.resolveComposioActingUserId(orgId, userId);
    const apiClient = await this.requireAvailable();
    const orgToolkit = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);

    const connection = await this.databaseAdapter.getComposioUserConnection(
      actingUserId,
      orgToolkit.id
    );

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
    this.invalidateProfileSessionCachesForUser(orgId, actingUserId);

    return toOrgToolkitSummary(orgToolkit);
  }

  async syncUserToolkit(
    orgId: string,
    userId: string,
    toolkitSlug: string
  ): Promise<ComposioToolkitSummary> {
    const actingUserId = await this.resolveComposioActingUserId(orgId, userId);
    const apiClient = await this.requireAvailable();
    const orgToolkit = await this.getOwnedToolkitBySlug(orgId, toolkitSlug);

    const connection = await this.databaseAdapter.getComposioUserConnection(
      actingUserId,
      orgToolkit.id
    );

    if (!connection || connection.status !== "connected") {
      throw new NakamaApiError(
        "Connect the toolkit before syncing tools.",
        400
      );
    }

    try {
      const connectedAccountsByToolkit = connection.connectedAccountId
        ? { [orgToolkit.toolkitSlug]: connection.connectedAccountId }
        : {};

      const session = await apiClient.createProfileSession(
        composioUserId(actingUserId),
        [orgToolkit.toolkitSlug],
        { [orgToolkit.toolkitSlug]: null },
        connectedAccountsByToolkit
      );

      const cachedTools = await apiClient.listSessionTools(session);

      const updatedOrgToolkit: StoredComposioToolkitRecord = {
        ...orgToolkit,
        cachedTools,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };

      const updatedConnection: StoredComposioUserConnectionRecord = {
        ...connection,
        lastError: null,
        sessionIdEnc: await this.encryptSessionId(session.sessionId),
        updatedAt: new Date().toISOString(),
      };

      await this.databaseAdapter.upsertComposioToolkit(updatedOrgToolkit);
      await this.databaseAdapter.upsertComposioUserConnection(
        updatedConnection
      );
      this.invalidateProfileSessionCachesForUser(orgId, actingUserId);

      return toOrgToolkitSummary(updatedOrgToolkit);
    } catch (error) {
      if (
        error instanceof Error &&
        (await this.markRejectedConnections(
          orgId,
          actingUserId,
          [connection],
          error,
          connection.connectedAccountId ? [connection.connectedAccountId] : []
        )) > 0
      ) {
        throw new NakamaApiError(STALE_CONNECTION_ERROR, 409);
      }

      const message = error instanceof Error ? error.message : String(error);

      const updatedConnection: StoredComposioUserConnectionRecord = {
        ...connection,
        lastError: message,
        updatedAt: new Date().toISOString(),
      };

      await this.databaseAdapter.upsertComposioUserConnection(
        updatedConnection
      );
      throw error;
    }
  }

  async listProfileAssignments(
    orgId: string,
    profile: StoredProfileRecord
  ): Promise<ListProfileComposioToolkitsResponse> {
    this.assertProfileOrg(profile, orgId);

    const assignments = await this.databaseAdapter.listProfileComposioToolkits(
      profile.id
    );

    const orgToolkits =
      await this.databaseAdapter.listComposioToolkitsForOrg(orgId);

    const toolkitById = new Map(
      orgToolkits.map((toolkit) => [toolkit.id, toolkit])
    );

    return {
      assignments: assignments
        .map((assignment) => {
          const toolkit = toolkitById.get(assignment.toolkitId);

          if (!toolkit) {
            return null;
          }

          return {
            allowedActions: assignment.allowedActions,
            toolkitId: assignment.toolkitId,
            toolkitSlug: toolkit.toolkitSlug,
          } satisfies ProfileComposioToolkitAssignment;
        })
        .filter(
          (assignment): assignment is ProfileComposioToolkitAssignment =>
            assignment !== null
        ),
    };
  }

  async updateProfileAssignments(
    orgId: string,
    profile: StoredProfileRecord,
    input: UpdateProfileComposioToolkitsRequest
  ): Promise<ListProfileComposioToolkitsResponse> {
    this.assertProfileOrg(profile, orgId);

    if (await this.databaseAdapter.getSharedAgentInstance(orgId, profile.id)) {
      throw new NakamaApiError("Shared agent configuration is read-only.", 403);
    }

    const request: UpdateProfileComposioToolkitsRequest =
      normalizeUpdateProfileComposioToolkitsRequest(input);

    const orgToolkits =
      await this.databaseAdapter.listComposioToolkitsForOrg(orgId);

    const toolkitById = new Map(
      orgToolkits.map((toolkit) => [toolkit.id, toolkit])
    );

    const assignments: StoredProfileComposioToolkitRecord[] = [];

    for (const assignment of request.assignments) {
      const toolkit = toolkitById.get(assignment.toolkitId);

      if (!toolkit || toolkit.orgId !== orgId) {
        throw new NakamaApiError(
          "Composio toolkit not found for this organization.",
          404
        );
      }

      assignments.push({
        allowedActions: assignment.allowedActions ?? null,
        profileId: profile.id,
        toolkitId: assignment.toolkitId,
      });
    }

    await this.databaseAdapter.replaceProfileComposioToolkits(
      profile.id,
      assignments
    );
    this.bumpRevision(orgId);

    return this.listProfileAssignments(orgId, profile);
  }

  async getProfileSessionEndpoint(
    orgId: string,
    userId: string,
    profileId: string
  ): Promise<ComposioSessionMcpEndpoint | null> {
    const actingUserId = await this.resolveComposioActingUserId(orgId, userId);

    const cacheKey = this.profileSessionCacheKey(
      orgId,
      actingUserId,
      profileId
    );

    this.profileSessionErrors.delete(cacheKey);
    const apiClient = await this.getApiClient();

    if (!apiClient) {
      return null;
    }

    const assignments =
      await this.databaseAdapter.listProfileComposioToolkits(profileId);

    if (assignments.length === 0) {
      return null;
    }

    const orgToolkits =
      await this.databaseAdapter.listComposioToolkitsForOrg(orgId);

    const toolkitById = new Map(
      orgToolkits.map((toolkit) => [toolkit.id, toolkit])
    );

    const enabledToolkits: string[] = [];
    const allowedToolsByToolkit: Record<string, string[] | null> = {};
    const connectedAccountsByToolkit: Record<string, string> = {};

    const userConnections =
      await this.databaseAdapter.listComposioUserConnectionsForUser(
        orgId,
        actingUserId
      );

    const connectionByToolkitId = new Map(
      userConnections.map(
        (connection) => [connection.toolkitId, connection] as const
      )
    );

    for (const assignment of assignments) {
      const toolkit = toolkitById.get(assignment.toolkitId);
      const connection = connectionByToolkitId.get(assignment.toolkitId);

      if (
        !toolkit ||
        toolkit.status !== "enabled" ||
        connection?.status !== "connected"
      ) {
        continue;
      }

      enabledToolkits.push(toolkit.toolkitSlug);
      allowedToolsByToolkit[toolkit.toolkitSlug] = assignment.allowedActions;

      if (connection.connectedAccountId) {
        connectedAccountsByToolkit[toolkit.toolkitSlug] =
          connection.connectedAccountId;
      }
    }

    if (enabledToolkits.length === 0) {
      return null;
    }

    const fingerprint = this.buildProfileSessionFingerprint(
      enabledToolkits,
      allowedToolsByToolkit,
      connectedAccountsByToolkit
    );

    const cached = this.profileSessionCache.get(cacheKey);

    if (cached?.fingerprint === fingerprint) {
      return cached.endpoint;
    }

    let endpoint: ComposioSessionMcpEndpoint;

    try {
      endpoint = await apiClient.createProfileSession(
        composioUserId(actingUserId),
        enabledToolkits,
        allowedToolsByToolkit,
        connectedAccountsByToolkit
      );
    } catch (error) {
      const marked =
        error instanceof Error
          ? await this.markRejectedConnections(
              orgId,
              actingUserId,
              userConnections,
              error,
              Object.values(connectedAccountsByToolkit)
            )
          : 0;

      if (marked === 0) {
        this.profileSessionErrors.set(
          cacheKey,
          error instanceof Error ? error.message : String(error)
        );
        // Rebuild the chat on the next turn, so it tries to open again.
        this.bumpRevision(orgId);
        throw error;
      }

      // The marked connections now read as "error", so the retry leaves them
      // out and the user's other apps keep working.
      return this.getProfileSessionEndpoint(orgId, userId, profileId);
    }

    this.profileSessionCache.set(cacheKey, { endpoint, fingerprint });

    return endpoint;
  }

  /**
   * Marks the connections whose account Composio refused, so the UI asks the
   * user to connect the app again. Returns how many were marked; 0 when the
   * error is not a refused account.
   */
  private async markRejectedConnections(
    orgId: string,
    actingUserId: string,
    connections: StoredComposioUserConnectionRecord[],
    error: Error,
    requestedIds: string[]
  ): Promise<number> {
    const rejected = findRejectedConnectedAccountIds(error, requestedIds);

    if (!rejected) {
      return 0;
    }

    const now = new Date().toISOString();
    let marked = 0;

    for (const connection of connections) {
      if (
        connection.connectedAccountId === null ||
        !rejected.includes(connection.connectedAccountId)
      ) {
        continue;
      }

      // Read the row again: the user can connect the app again while
      // Composio answers, and that new account must not be overwritten.
      const current = await this.databaseAdapter.getComposioUserConnection(
        connection.userId,
        connection.toolkitId
      );

      if (
        current?.status !== "connected" ||
        current.connectedAccountId !== connection.connectedAccountId
      ) {
        continue;
      }

      await this.databaseAdapter.upsertComposioUserConnection({
        ...current,
        lastError: STALE_CONNECTION_ERROR,
        sessionIdEnc: null,
        status: "error",
        updatedAt: now,
      });
      marked += 1;
    }

    if (marked > 0) {
      console.warn(
        `Composio refused ${marked} connected account(s) for org ${orgId}; marked them for reconnection.`
      );
      this.invalidateProfileSessionCachesForUser(orgId, actingUserId);
    }

    return marked;
  }

  async formatProfileConnectionsContext(
    orgId: string,
    userId: string,
    profileId: string
  ): Promise<string> {
    if (!(await this.isAvailable())) {
      return "";
    }

    const assigned = await this.getAssignedToolkitRecords(
      orgId,
      userId,
      profileId
    );

    if (assigned.length === 0) {
      return "";
    }

    const lines = assigned.map(
      ({ orgToolkit, userConnection, allowedActions }) => {
        const toolCount = orgToolkit.cachedTools.length;

        const toolsSuffix =
          toolCount > 0
            ? `, ${toolCount} tool${toolCount === 1 ? "" : "s"}`
            : "";

        const actionsSuffix =
          allowedActions && allowedActions.length > 0
            ? ` (allowed actions: ${allowedActions.join(", ")})`
            : "";

        const connectionStatus = userConnection?.status ?? "not_connected";

        return `- ${orgToolkit.displayName} (\`${orgToolkit.toolkitSlug}\`): org ${orgToolkit.status}, your connection ${connectionStatus}${toolsSuffix}${actionsSuffix}`;
      }
    );

    const actingUserId = await this.resolveComposioActingUserId(orgId, userId);

    const sessionError = this.profileSessionErrors.get(
      this.profileSessionCacheKey(orgId, actingUserId, profileId)
    );

    const hasConnected =
      !sessionError &&
      assigned.some(
        ({ userConnection }) => userConnection?.status === "connected"
      );

    const workflowGuidance = hasConnected
      ? [
          "For connected toolkits, Composio is exposed as two tools: `composio__search_actions` (search the action catalog) and `composio__invoke_action` (call an action by slug). Workflow: call `composio__search_actions` with a query and optional `toolkit_slug` to find actions, then call `composio__invoke_action` with the returned action slug and its arguments.",
          "Reach for Composio when the task needs the user's own SaaS data or actions — read/send their Gmail, check their calendar, manage their files. For public facts about a third party (a company's domain, a public email address, public docs), prefer `web_search` instead; Composio only sees the user's connected account, not the public web.",
        ]
      : [];

    return [
      "## Composio integrations",
      "",
      "Assigned SaaS toolkits for this profile (your personal connections):",
      ...lines,
      "",
      ...workflowGuidance,
      ...(sessionError
        ? [
            `Composio tools are not available in this turn because the session did not open (${sessionError}). If the task needs them, tell the user.`,
          ]
        : []),
      "Only connected toolkits can be invoked. If a connection is missing, call `composio__connect_account` with the toolkit slug. If the result has an OAuth link, send it to the user.",
    ].join("\n");
  }

  async getAssignedToolkitRecords(
    orgId: string,
    userId: string,
    profileId: string
  ): Promise<
    Array<{
      orgToolkit: StoredComposioToolkitRecord;
      userConnection: StoredComposioUserConnectionRecord | null;
      allowedActions: string[] | null;
    }>
  > {
    const actingUserId = await this.resolveComposioActingUserId(orgId, userId);

    const assignments =
      await this.databaseAdapter.listProfileComposioToolkits(profileId);

    const orgToolkits =
      await this.databaseAdapter.listComposioToolkitsForOrg(orgId);

    const toolkitById = new Map(
      orgToolkits.map((toolkit) => [toolkit.id, toolkit])
    );

    const userConnections =
      await this.databaseAdapter.listComposioUserConnectionsForUser(
        orgId,
        actingUserId
      );

    const connectionByToolkitId = new Map(
      userConnections.map(
        (connection) => [connection.toolkitId, connection] as const
      )
    );

    return assignments
      .map((assignment) => {
        const orgToolkit = toolkitById.get(assignment.toolkitId);

        if (!orgToolkit) {
          return null;
        }

        return {
          allowedActions: assignment.allowedActions,
          orgToolkit,
          userConnection:
            connectionByToolkitId.get(assignment.toolkitId) ?? null,
        };
      })
      .filter(
        (
          entry
        ): entry is {
          orgToolkit: StoredComposioToolkitRecord;
          userConnection: StoredComposioUserConnectionRecord | null;
          allowedActions: string[] | null;
        } => entry !== null
      );
  }

  private profileSessionCacheKey(
    orgId: string,
    userId: string,
    profileId: string
  ): string {
    return `${orgId}:${userId}:${profileId}`;
  }

  private buildProfileSessionFingerprint(
    enabledToolkits: string[],
    allowedToolsByToolkit: Record<string, string[] | null>,
    connectedAccountsByToolkit: Record<string, string>
  ): string {
    return JSON.stringify({
      allowedToolsByToolkit,
      connectedAccountsByToolkit,
      key: this.apiClientCache?.key,
      toolkits: [...enabledToolkits].sort(),
    });
  }

  private invalidateProfileSessionCachesForUser(
    orgId: string,
    userId: string
  ): void {
    this.bumpRevision(orgId);
    const suffix = `:${userId}:`;

    for (const key of this.profileSessionCache.keys()) {
      if (key.includes(suffix)) {
        this.profileSessionCache.delete(key);
      }
    }
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
      throw new NakamaApiError(
        "Composio is not configured on this deployment.",
        503
      );
    }

    return apiClient;
  }

  private async getOwnedToolkit(
    orgId: string,
    toolkitId: string
  ): Promise<StoredComposioToolkitRecord> {
    const record = await this.databaseAdapter.getComposioToolkit(toolkitId);

    if (!record || record.orgId !== orgId) {
      throw new NakamaApiError("Composio toolkit not found.", 404);
    }

    return record;
  }

  private async getOwnedToolkitBySlug(
    orgId: string,
    toolkitSlug: string
  ): Promise<StoredComposioToolkitRecord> {
    const record = await this.databaseAdapter.getComposioToolkitBySlug(
      orgId,
      toolkitSlug
    );

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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Composio tool payloads are untyped JSON that this function inspects structurally.
function meetString(value: unknown): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Composio tool payloads are untyped JSON narrowed here by shape.
  return typeof value === "string" ? value.trim() : "";
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Composio tool payloads are untyped JSON that this function inspects structurally.
function unwrapMeetToolResult(value: unknown): unknown {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Composio tool payloads are untyped JSON narrowed here by shape.
  if (!value || typeof value !== "object") {
    return value;
  }

  // SAFETY: The surrounding code checked this value before the assertion.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Composio tool payloads are untyped JSON objects.
  const record = value as Record<string, unknown>;

  if (record.successful === false) {
    throw new Error(meetString(record.error) || "Composio request failed.");
  }

  if (!("data" in record)) {
    return value;
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Composio tool payloads are untyped JSON narrowed here by shape.
  if (typeof record.data === "string") {
    try {
      return unwrapMeetToolResult(JSON.parse(record.data));
    } catch {
      return record.data;
    }
  }

  return unwrapMeetToolResult(record.data);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- Composio tool payloads are untyped JSON that this function inspects structurally.
function findMeetMessages(value: unknown): Record<string, unknown>[] {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Composio tool payloads are untyped JSON objects.
  const found: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Composio tool payloads are untyped JSON that this function inspects structurally.
  const visit = (node: unknown, depth: number) => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Composio tool payloads are untyped JSON narrowed here by shape.
    if (depth > 6 || !node || typeof node !== "object") {
      return;
    }

    // SAFETY: The surrounding code checked this value before the assertion.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Composio tool payloads are untyped JSON objects.
    const record = node as Record<string, unknown>;
    const id = meetString(record.messageId ?? record.id);

    if (
      id &&
      (record.messageId ||
        record.threadId ||
        record.subject ||
        record.snippet ||
        record.payload) &&
      !seen.has(id)
    ) {
      seen.add(id);
      found.push(record);
    }

    for (const child of Object.values(record)) {
      visit(child, depth + 1);
    }
  };

  visit(value, 0);

  return found;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Composio tool payloads are untyped JSON that this function inspects structurally.
function extractMeetDriveIds(value: unknown): string[] {
  const ids = new Set<string>();

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Composio tool payloads are untyped JSON that this function inspects structurally.
  const visit = (node: unknown, depth: number) => {
    if (depth > 10 || !node) {
      return;
    }

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Composio tool payloads are untyped JSON narrowed here by shape.
    if (typeof node === "string") {
      let text = node;

      if (
        text.length > 50 &&
        !text.includes("://") &&
        /^[A-Za-z0-9_+/=\s-]+$/.test(text)
      ) {
        const decoded = Buffer.from(
          text.replace(/-/g, "+").replace(/_/g, "/"),
          "base64"
        ).toString("utf8");

        if (decoded.includes("drive.google.com")) {
          text = decoded;
        }
      }

      text = text.replace(/&amp;/g, "&");

      try {
        text = decodeURIComponent(text);
      } catch {
        /* Keep original text. */
      }

      for (const pattern of [
        /drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})/g,
        /drive\.google\.com\/(?:open|uc)\?[^\s"'<>]*?id=([A-Za-z0-9_-]{10,})/g,
        /docs\.google\.com\/[A-Za-z]+\/d\/([A-Za-z0-9_-]{10,})/g,
      ]) {
        for (const match of text.matchAll(pattern)) {
          ids.add(match[1]!);
        }
      }

      return;
    }

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Composio tool payloads are untyped JSON narrowed here by shape.
    if (typeof node === "object") {
      for (const child of Object.values(node)) {
        visit(child, depth + 1);
      }
    }
  };

  visit(value, 0);

  return [...ids];
}
