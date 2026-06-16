import {
  formatServerError,
  TinyClawApiError,
  TINYCLAW_API_VERSION,
  type AgentChannel,
  type AgentTodo,
  type ApiErrorResponse,
  type AssignToolRequest,
  type BranchSessionRequest,
  type BranchSessionResponse,
  type CreateProfileRequest,
  type CreateAutomationRequest,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type CreateToolRequest,
  type DraftAutomationRequest,
  type DraftAutomationResponse,
  type ListAutomationRunsResponse,
  type ListAutomationsResponse,
  type AutomationResponse,
  type RunAutomationResponse,
  type TelegramSettingsResponse,
  type ThinkingSettingsResponse,
  type TimezoneSettingsResponse,
  type UpdateThinkingRequest,
  type ListTimezonesResponse,
  type UpdateAutomationRequest,
  type UpdateTimezoneRequest,
  type UpdateTelegramSettingsRequest,
  type UpdateWhatsAppSettingsRequest,
  type WhatsAppSettingsResponse,
  type HealthResponse,
  type InitSoulResponse,
  type InitUserContextResponse,
  type ListProfilesResponse,
  type ListToolsResponse,
  type ToolResponse,
  type ToolSourceResponse,
  type ListSessionsResponse,
  type ModelsResponse,
  type ProfileResponse,
  type SendMessageInput,
  type SendMessageRequest,
  type SendMessageResponse,
  type SessionMessagesResponse,
  type SetModelRequest,
  type SetModelResponse,
  type ConfigureProviderRequest,
  type ConfigureProviderResponse,
  type CreateProviderRequest,
  type CreateProviderResponse,
  type DeleteKnowledgeBaseResponse,
  type DeleteProviderResponse,
  type ListKnowledgeBaseResponse,
  type ListProvidersResponse,
  type UpdateProviderRequest,
  type UpdateProviderResponse,
  type DiscoverModelsRequest,
  type CompactSessionRequest,
  type CompactionResponse,
  type SoulStackResponse,
  type SoulStatusResponse,
  type StreamEvent,
  type SystemStatusResponse,
  type UpdateProfileRequest,
  type UpdateSoulFileRequest,
  type UploadKnowledgeBaseRequest,
  type UploadKnowledgeBaseResponse,
  type UpdateUserContextRequest,
  type ImageAttachment,
  type UserContextStatusResponse,
  type CreateTaskRequest,
  type DraftTaskPromptRequest,
  type DraftTaskPromptResponse,
  type UpdateTaskRequest,
  type ListTasksResponse,
  type TaskResponse,
  type RunTaskResponse,
  type ListTaskRunsResponse,
  type TaskMessagesResponse,
  type AssignMcpServerRequest,
  type AssignSkillRequest,
  type CreateMcpServerRequest,
  type CreateSkillRequest,
  type ListMcpServersResponse,
  type ListSkillsResponse,
  type McpServerResponse,
  type SkillResponse,
  type SyncSkillsResponse,
  type TestMcpServerResponse,
  type UpdateMcpServerRequest,
} from "@tinyclaw/core";
import type { AgentChatSession } from "@tinyclaw/agent";
import { serializeOpenApiSpec } from "./openapi/build-spec";
import type { AgentService } from "./services/agent-service";
import type { AutomationService } from "./services/automation-service";
import type { McpService } from "./services/mcp-service";
import type { TaskService } from "./services/task-service";
import { getTimezoneCatalog } from "./services/timezone-catalog-service";
import { SystemStatusService } from "./services/system-status-service";
import type { WorkerManagerService } from "./services/worker-manager-service";
import type { AuthService } from "./services/auth-service";
import type { DatabaseAdapter } from "@tinyclaw/db";
import { tryServeStaticWeb } from "./static-web";

const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TinyClaw API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference("#app", {
        url: "/openapi.json",
        theme: "default",
      });
    </script>
  </body>
</html>
`;

export interface ServerOptions {
  agent: AgentService;
  automationService: AutomationService;
  taskService: TaskService;
  systemStatus: SystemStatusService;
  workerManager: WorkerManagerService;
  mcpService: McpService;
  authService?: AuthService | null;
  databaseAdapter?: DatabaseAdapter | null;
  webDistDir?: string | null;
}

export function createApp(options: ServerOptions) {
  const {
    agent,
    automationService,
    taskService,
    systemStatus,
    workerManager,
    mcpService,
    authService,
    databaseAdapter,
    webDistDir = null,
  } = options;

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      try {
        if (request.method === "GET" && url.pathname === "/openapi.json") {
          return new Response(serializeOpenApiSpec(), {
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }

        if (
          request.method === "GET" &&
          (url.pathname === "/docs" || url.pathname === "/docs/")
        ) {
          return new Response(DOCS_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        if (request.method === "GET" && url.pathname === "/health") {
          const userCount = await databaseAdapter?.countUsers() ?? 0;
          return json<HealthResponse>({
            ok: true,
            apiVersion: TINYCLAW_API_VERSION,
            providerConfigured: agent.providerConfigured,
            userConfigured: userCount > 0,
          });
        }

        // Auth endpoints
        if (request.method === "POST" && url.pathname === "/v1/auth/setup") {
          if (!authService || !databaseAdapter) {
            return errorResponse("Authentication not configured", 500);
          }

          const userCount = await databaseAdapter.countUsers();
          if (userCount > 0) {
            return errorResponse("Admin user already exists", 409);
          }

          const body = await readJson<{ email: string; password: string }>(request);
          const hash = await authService.hashPassword(body.password);
          const now = new Date().toISOString();

          await databaseAdapter.createUser({
            id: "user_admin",
            email: body.email,
            passwordHash: hash,
            createdAt: now,
            updatedAt: now,
          });

          const token = await authService.createToken(body.email);
          return json({ token }, 201);
        }

        if (request.method === "POST" && url.pathname === "/v1/auth/login") {
          const body = await readJson<{ email: string; password: string }>(request);

          if (!authService || !databaseAdapter) {
            return errorResponse("Authentication not configured", 500);
          }

          const user = await databaseAdapter.getUserByEmail(body.email);
          if (!user) {
            return errorResponse("Invalid credentials", 401);
          }

          const valid = await authService.verifyPassword(body.password, user.passwordHash);
          if (!valid) {
            return errorResponse("Invalid credentials", 401);
          }

          const token = await authService.createToken(user.email);
          return json({ token });
        }

        if (request.method === "GET" && url.pathname === "/v1/auth/me") {
          if (!authService) {
            return errorResponse("Authentication not configured", 500);
          }

          const authHeader = request.headers.get("Authorization");
          if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return errorResponse("Authentication required", 401);
          }

          const token = authHeader.slice(7);
          try {
            const payload = await authService.verifyToken(token);
            return json({ email: payload.email });
          } catch {
            return errorResponse("Invalid token", 401);
          }
        }

        // Auth middleware for all other routes
        if (authService) {
          const isPublicRoute =
            url.pathname === "/health" ||
            url.pathname === "/docs" ||
            url.pathname === "/docs/" ||
            url.pathname === "/openapi.json" ||
            url.pathname === "/v1/auth/setup" ||
            url.pathname === "/v1/auth/login" ||
            url.pathname === "/v1/auth/me" ||
            url.pathname === "/v1/tasks/__capability_probe__/messages" ||
            url.pathname === "/v1/tools" ||
            (request.method === "GET" &&
              /^\/v1\/profiles\/[^/]+\/avatar$/.test(url.pathname));

          if (!isPublicRoute) {
            const authHeader = request.headers.get("Authorization");
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
              return errorResponse("Authentication required", 401);
            }

            const token = authHeader.slice(7);
            try {
              await authService.verifyToken(token);
            } catch {
              return errorResponse("Invalid token", 401);
            }
          }
        }

        if (request.method === "GET" && url.pathname === "/v1/system/status") {
          return json<SystemStatusResponse>(await systemStatus.getStatus());
        }

        const workerActionMatch = url.pathname.match(/^\/v1\/workers\/([^/]+)\/(start|stop|restart)$/);

        if (workerActionMatch && request.method === "POST") {
          const name = decodeURIComponent(workerActionMatch[1]!);
          const action = workerActionMatch[2];

          if (!workerManager.isValidWorker(name)) {
            return errorResponse(`Unknown worker: ${name}`, 400);
          }

          try {
            if (action === "start") {
              await workerManager.startWorker(name);
            } else if (action === "stop") {
              await workerManager.stopWorker(name);
            } else {
              await workerManager.restartWorker(name);
            }

            return json({ ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return errorResponse(message, 500);
          }
        }

        if (request.method === "GET" && url.pathname === "/v1/models") {
          const source = url.searchParams.get("source");
          const modelsSource =
            source === "remote" ? ("remote" as const) : ("catalog" as const);
          return json<ModelsResponse>(
            await agent.getModels({ source: modelsSource }),
          );
        }

        if (request.method === "POST" && url.pathname === "/v1/models/discover") {
          const body = await readJson<DiscoverModelsRequest>(request);
          const result = await agent.discoverModels(body.baseUrl, body.apiKey ?? "");
          return json<ModelsResponse>(result);
        }

        if (request.method === "GET" && url.pathname === "/v1/providers") {
          return json<ListProvidersResponse>(await agent.listProviders());
        }

        if (request.method === "POST" && url.pathname === "/v1/providers") {
          const body = await readJson<CreateProviderRequest>(request);
          return json<CreateProviderResponse>(await agent.createProvider(body));
        }

        const providerRoute = matchProviderRoute(url.pathname);

        if (providerRoute && request.method === "PATCH") {
          const body = await readJson<UpdateProviderRequest>(request);
          return json<UpdateProviderResponse>(
            await agent.updateProvider(providerRoute, body),
          );
        }

        if (providerRoute && request.method === "DELETE") {
          return json<DeleteProviderResponse>(await agent.deleteProvider(providerRoute));
        }

        if (request.method === "PUT" && url.pathname === "/v1/settings/model") {
          const body = await readJson<SetModelRequest>(request);
          const result = await agent.setModel(body);

          return json<SetModelResponse>(result);
        }

        if (request.method === "PUT" && url.pathname === "/v1/settings/provider") {
          const body = await readJson<ConfigureProviderRequest>(request);
          const result = await agent.configureProvider(body);

          return json<ConfigureProviderResponse>(result);
        }

        if (request.method === "GET" && url.pathname === "/v1/timezones") {
          return json<ListTimezonesResponse>(await getTimezoneCatalog());
        }

        if (request.method === "GET" && url.pathname === "/v1/settings/timezone") {
          return json<TimezoneSettingsResponse>({
            timezone: await agent.getUserTimezone(),
          });
        }

        if (request.method === "PUT" && url.pathname === "/v1/settings/timezone") {
          const body = await readJson<UpdateTimezoneRequest>(request);
          const timezone = await agent.setUserTimezone(body.timezone);

          return json<TimezoneSettingsResponse>({ timezone });
        }

        if (request.method === "GET" && url.pathname === "/v1/settings/thinking") {
          return json<ThinkingSettingsResponse>(await agent.getThinkingSettings());
        }

        if (request.method === "PUT" && url.pathname === "/v1/settings/thinking") {
          const body = await readJson<UpdateThinkingRequest>(request);
          return json<ThinkingSettingsResponse>(await agent.setThinkingSettings(body));
        }

        if (request.method === "GET" && url.pathname === "/v1/settings/telegram") {
          return json<TelegramSettingsResponse>(await agent.getTelegramSettings());
        }

        if (request.method === "PUT" && url.pathname === "/v1/settings/telegram") {
          const body = await readJson<UpdateTelegramSettingsRequest>(request);

          try {
            return json<TelegramSettingsResponse>(await agent.setTelegramSettings(body));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return errorResponse(message, 400);
          }
        }

        if (request.method === "POST" && url.pathname === "/v1/settings/telegram/handshake") {
          try {
            return json<TelegramSettingsResponse>(await agent.regenerateTelegramHandshake());
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return errorResponse(message, 400);
          }
        }

        if (request.method === "GET" && url.pathname === "/v1/settings/whatsapp") {
          return json<WhatsAppSettingsResponse>(await agent.getWhatsAppSettings());
        }

        if (request.method === "PUT" && url.pathname === "/v1/settings/whatsapp") {
          const body = await readJson<UpdateWhatsAppSettingsRequest>(request);

          try {
            return json<WhatsAppSettingsResponse>(await agent.setWhatsAppSettings(body));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return errorResponse(message, 400);
          }
        }

        if (request.method === "POST" && url.pathname === "/v1/settings/whatsapp/pairing-code") {
          try {
            return json<WhatsAppSettingsResponse>(await agent.regenerateWhatsAppPairingCode());
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return errorResponse(message, 400);
          }
        }

        if (request.method === "GET" && url.pathname === "/v1/user/context") {
          const includeContent = url.searchParams.get("content") === "true";
          return json<UserContextStatusResponse>(await agent.getUserContext(includeContent));
        }

        if (request.method === "PUT" && url.pathname === "/v1/user/context") {
          const body = await readJson<UpdateUserContextRequest>(request);
          await agent.writeUserContext(body);
          return new Response(null, { status: 204 });
        }

        if (request.method === "POST" && url.pathname === "/v1/user/context/init") {
          return json<InitUserContextResponse>(await agent.initUserContext(), 201);
        }

        if (request.method === "POST" && url.pathname === "/v1/sessions") {
          const body = await readJson<CreateSessionRequest>(request);
          const sessionId = await agent.createSession(
            parseChannel(body.channel),
            body.profileId,
          );

          return json<CreateSessionResponse>({ sessionId }, 201);
        }

        if (request.method === "GET" && url.pathname === "/v1/sessions") {
          const profileId = url.searchParams.get("profileId")?.trim();
          const channel = parseChannel(url.searchParams.get("channel") ?? "web");

          if (!profileId) {
            return errorResponse("profileId is required.", 400);
          }

          return json<ListSessionsResponse>(
            await agent.listSessions(profileId, channel),
          );
        }

        if (request.method === "GET" && url.pathname === "/v1/profiles") {
          return json<ListProfilesResponse>(await agent.listProfiles());
        }

        if (request.method === "POST" && url.pathname === "/v1/profiles") {
          const body = await readJson<CreateProfileRequest>(request);
          return json<ProfileResponse>(await agent.createProfile(body), 201);
        }

        if (request.method === "GET" && url.pathname === "/v1/mcp/servers") {
          return json<ListMcpServersResponse>(await mcpService.listServers());
        }

        if (request.method === "POST" && url.pathname === "/v1/mcp/servers") {
          const body = await readJson<CreateMcpServerRequest>(request);
          return json<McpServerResponse>(await mcpService.createServer(body), 201);
        }

        if (request.method === "POST" && url.pathname === "/v1/mcp/servers/test") {
          const body = await readJson<CreateMcpServerRequest>(request);
          return json<TestMcpServerResponse>(
            await mcpService.testServer(body.transport, body.config, body.serverId),
          );
        }

        const mcpServerActionMatch = url.pathname.match(
          /^\/v1\/mcp\/servers\/([^/]+)\/(connect|sync)$/,
        );

        if (mcpServerActionMatch && request.method === "POST") {
          const serverId = decodeURIComponent(mcpServerActionMatch[1]!);
          const action = mcpServerActionMatch[2];

          if (action === "connect") {
            return json<McpServerResponse>(await mcpService.connectServer(serverId));
          }

          return json<McpServerResponse>(await mcpService.syncServer(serverId));
        }

        const mcpServerMatch = url.pathname.match(/^\/v1\/mcp\/servers\/([^/]+)$/);

        if (mcpServerMatch && request.method === "GET") {
          const serverId = decodeURIComponent(mcpServerMatch[1]!);
          return json<McpServerResponse>(await mcpService.getServer(serverId));
        }

        if (mcpServerMatch && request.method === "PATCH") {
          const serverId = decodeURIComponent(mcpServerMatch[1]!);
          const body = await readJson<UpdateMcpServerRequest>(request);
          return json<McpServerResponse>(await mcpService.updateServer(serverId, body));
        }

        if (mcpServerMatch && request.method === "DELETE") {
          const serverId = decodeURIComponent(mcpServerMatch[1]!);
          await mcpService.deleteServer(serverId);
          return new Response(null, { status: 204 });
        }

        if (request.method === "GET" && url.pathname === "/v1/skills") {
          return json<ListSkillsResponse>(await agent.listSkills());
        }

        if (request.method === "POST" && url.pathname === "/v1/skills") {
          const body = await readJson<CreateSkillRequest>(request);
          return json<SkillResponse>(await agent.createSkill(body));
        }

        if (request.method === "POST" && url.pathname === "/v1/skills/sync") {
          return json<SyncSkillsResponse>(await agent.syncSkills());
        }

        const skillMatch = url.pathname.match(/^\/v1\/skills\/([^/]+)$/);

        if (skillMatch && request.method === "GET") {
          const skillId = decodeURIComponent(skillMatch[1]!);
          return json<SkillResponse>(await agent.getSkill(skillId));
        }

        if (skillMatch && request.method === "DELETE") {
          const skillId = decodeURIComponent(skillMatch[1]!);
          await agent.deleteSkill(skillId);
          return new Response(null, { status: 204 });
        }

        const profileSkillsMatch = url.pathname.match(
          /^\/v1\/profiles\/([^/]+)\/skills(?:\/([^/]+))?$/,
        );

        if (profileSkillsMatch) {
          const profileId = decodeURIComponent(profileSkillsMatch[1]!);

          if (request.method === "POST" && !profileSkillsMatch[2]) {
            const body = await readJson<AssignSkillRequest>(request);
            return json<ProfileResponse>(await agent.assignSkill(profileId, body));
          }

          if (request.method === "DELETE" && profileSkillsMatch[2]) {
            const skillId = decodeURIComponent(profileSkillsMatch[2]!);
            return json<ProfileResponse>(await agent.unassignSkill(profileId, skillId));
          }
        }

        if (request.method === "GET" && url.pathname === "/v1/tools") {
          return json<ListToolsResponse>(await agent.listTools());
        }

        if (request.method === "POST" && url.pathname === "/v1/tools") {
          const body = await readJson<CreateToolRequest>(request);
          return json(await agent.createTool(body), 201);
        }

        const toolSourceMatch = url.pathname.match(/^\/v1\/tools\/([^/]+)\/source$/);

        if (toolSourceMatch && request.method === "GET") {
          const toolId = decodeURIComponent(toolSourceMatch[1]!);
          return json<ToolSourceResponse>(await agent.getToolSource(toolId));
        }

        const toolMatch = url.pathname.match(/^\/v1\/tools\/([^/]+)$/);

        if (toolMatch && request.method === "GET") {
          const toolId = decodeURIComponent(toolMatch[1]!);
          return json<ToolResponse>(await agent.getTool(toolId));
        }

        if (toolMatch && request.method === "DELETE") {
          const toolId = decodeURIComponent(toolMatch[1]!);
          await agent.deleteTool(toolId);
          return new Response(null, { status: 204 });
        }

        const profileMcpServersMatch = url.pathname.match(
          /^\/v1\/profiles\/([^/]+)\/mcp-servers(?:\/([^/]+))?$/,
        );

        if (profileMcpServersMatch) {
          const profileId = decodeURIComponent(profileMcpServersMatch[1]!);

          if (request.method === "POST" && !profileMcpServersMatch[2]) {
            const body = await readJson<AssignMcpServerRequest>(request);
            return json<ProfileResponse>(await agent.assignMcpServer(profileId, body));
          }

          if (request.method === "DELETE" && profileMcpServersMatch[2]) {
            const serverId = decodeURIComponent(profileMcpServersMatch[2]!);
            return json<ProfileResponse>(
              await agent.unassignMcpServer(profileId, serverId),
            );
          }
        }

        const profileToolsMatch = url.pathname.match(
          /^\/v1\/profiles\/([^/]+)\/tools(?:\/([^/]+))?$/,
        );

        if (profileToolsMatch) {
          const profileId = decodeURIComponent(profileToolsMatch[1]!);

          if (request.method === "GET" && !profileToolsMatch[2]) {
            return json<ListToolsResponse>(await agent.listProfileTools(profileId));
          }

          if (request.method === "POST" && !profileToolsMatch[2]) {
            const body = await readJson<AssignToolRequest>(request);
            return json<ProfileResponse>(await agent.assignTool(profileId, body));
          }

          if (request.method === "DELETE" && profileToolsMatch[2]) {
            const toolId = decodeURIComponent(profileToolsMatch[2]!);
            return json<ProfileResponse>(
              await agent.unassignTool(profileId, toolId),
            );
          }
        }

        const profileSoulMatch = url.pathname.match(
          /^\/v1\/profiles\/([^/]+)\/soul(?:\/(init|stack|files\/([^/]+)))?$/,
        );

        if (profileSoulMatch) {
          const profileId = decodeURIComponent(profileSoulMatch[1]!);
          const subpath = profileSoulMatch[2];
          const fileKey = profileSoulMatch[3]
            ? decodeURIComponent(profileSoulMatch[3])
            : undefined;

          if (request.method === "GET" && !subpath) {
            const includeContents = url.searchParams.get("contents") === "true";
            return json<SoulStatusResponse>(
              await agent.getProfileSoulStatus(profileId, includeContents),
            );
          }

          if (request.method === "GET" && subpath === "stack") {
            return json<SoulStackResponse>(await agent.getProfileSoulStack(profileId));
          }

          if (request.method === "POST" && subpath === "init") {
            return json<InitSoulResponse>(
              await agent.initProfileSoul(profileId),
              201,
            );
          }

          if (request.method === "PUT" && subpath?.startsWith("files/") && fileKey) {
            const body = await readJson<UpdateSoulFileRequest>(request);
            await agent.writeProfileSoulFile(profileId, fileKey, body);
            return new Response(null, { status: 204 });
          }
        }

        const profileKnowledgeBaseMatch = url.pathname.match(
          /^\/v1\/profiles\/([^/]+)\/knowledge-base(?:\/([^/]+))?$/,
        );

        if (profileKnowledgeBaseMatch) {
          const profileId = decodeURIComponent(profileKnowledgeBaseMatch[1]!);
          const documentId = profileKnowledgeBaseMatch[2]
            ? decodeURIComponent(profileKnowledgeBaseMatch[2])
            : null;

          if (!documentId && request.method === "GET") {
            return json<ListKnowledgeBaseResponse>(await agent.listKnowledgeBase(profileId));
          }

          if (!documentId && request.method === "POST") {
            const body = await readJson<UploadKnowledgeBaseRequest>(request);
            return json<UploadKnowledgeBaseResponse>(
              await agent.uploadKnowledgeBaseDocument(profileId, body.document),
              201,
            );
          }

          if (documentId && request.method === "DELETE") {
            return json<DeleteKnowledgeBaseResponse>(
              await agent.deleteKnowledgeBaseDocument(profileId, documentId),
            );
          }
        }

        const profileAvatarMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/avatar$/);

        if (profileAvatarMatch) {
          const profileId = decodeURIComponent(profileAvatarMatch[1]!);

          if (request.method === "GET") {
            const avatar = await agent.getProfileAvatar(profileId);
            return new Response(avatar.bytes, {
              headers: { "Content-Type": avatar.mediaType },
            });
          }

          if (request.method === "PUT") {
            const body = await readJson<ImageAttachment>(request);
            return json<ProfileResponse>(await agent.uploadProfileAvatar(profileId, body));
          }

          if (request.method === "DELETE") {
            await agent.deleteProfileAvatar(profileId);
            return new Response(null, { status: 204 });
          }
        }

        const profileMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)$/);

        if (profileMatch) {
          const profileId = decodeURIComponent(profileMatch[1]!);

          if (request.method === "GET") {
            return json<ProfileResponse>(await agent.getProfile(profileId));
          }

          if (request.method === "PUT") {
            const body = await readJson<UpdateProfileRequest>(request);
            return json<ProfileResponse>(await agent.updateProfile(profileId, body));
          }

          if (request.method === "DELETE") {
            await agent.deleteProfile(profileId);
            return new Response(null, { status: 204 });
          }
        }

        const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);

        if (sessionMatch && request.method === "DELETE") {
          const sessionId = decodeURIComponent(sessionMatch[1]!);
          const purge = url.searchParams.get("purge") === "true";
          const cleared = purge
            ? await agent.purgeSession(sessionId)
            : await agent.clearSession(sessionId);

          if (!cleared) {
            return errorResponse("Session not found", 404);
          }

          return new Response(null, { status: 204 });
        }

        const messageMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
        const branchMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/branch$/);

        const compactMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/compact$/);

        if (compactMatch && request.method === "POST") {
          const sessionId = decodeURIComponent(compactMatch[1]!);
          const body = await readJson<CompactSessionRequest>(request).catch(() => ({}));
          const result = await agent.compactSession(sessionId, {
            force: body.force ?? false,
          });

          if (!result) {
            return errorResponse("Session not found", 404);
          }

          return json<CompactionResponse>(result);
        }

        if (messageMatch && request.method === "GET") {
          const sessionId = decodeURIComponent(messageMatch[1]!);
          const result = await agent.getSessionMessages(sessionId);

          if (!result) {
            return errorResponse("Session not found", 404);
          }

          const todos = (await agent.getSessionTodos(sessionId)) ?? [];

          return json<SessionMessagesResponse>({
            messages: result.messages,
            messageMeta: result.messageMeta,
            todos,
          });
        }

        if (branchMatch && request.method === "POST") {
          try {
            const sessionId = decodeURIComponent(branchMatch[1]!);
            const body = await readJson<BranchSessionRequest>(request);
            const result = await agent.branchSession(sessionId, body.messageIndex);

            if (!result) {
              return errorResponse("Session not found", 404);
            }

            return json<BranchSessionResponse>(result, 201);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return errorResponse(message, 400);
          }
        }

        if (messageMatch && request.method === "POST") {
          const sessionId = decodeURIComponent(messageMatch[1]!);
          const session = await agent.resolveSession(sessionId);

          if (!session) {
            return errorResponse("Session not found", 404);
          }

          const body = await readJson<SendMessageRequest>(request);
          const input = {
            message: body.message ?? "",
            images: body.images,
            documents: body.documents,
          };
          const wantsStream =
            body.stream === true ||
            url.searchParams.get("stream") === "true" ||
            request.headers.get("Accept")?.includes("text/event-stream");

          if (wantsStream) {
            return streamMessage(session, input, () => {
              agent.scheduleSessionTitleGeneration(sessionId);
            });
          }

          const reply = await session.send(input);
          agent.scheduleSessionTitleGeneration(sessionId);

          return json<SendMessageResponse>({ reply });
        }

        if (request.method === "POST" && url.pathname === "/v1/automations/draft") {
          const body = await readJson<DraftAutomationRequest>(request);
          const automation = await agent.draftAutomation(
            body.prompt,
            parseChannel(body.channel),
          );

          return json<DraftAutomationResponse>({ automation });
        }

        if (request.method === "GET" && url.pathname === "/v1/automations") {
          const automations = await automationService.list();
          return json<ListAutomationsResponse>({ automations });
        }

        if (request.method === "POST" && url.pathname === "/v1/automations") {
          const body = await readJson<CreateAutomationRequest>(request);
          const automation = await automationService.create(body, body.profileId);

          return json<AutomationResponse>({ automation }, 201);
        }

        const automationMatch = url.pathname.match(/^\/v1\/automations\/([^/]+)$/);
        const automationRunsMatch = url.pathname.match(
          /^\/v1\/automations\/([^/]+)\/runs$/,
        );
        const automationRunMatch = url.pathname.match(
          /^\/v1\/automations\/([^/]+)\/run$/,
        );

        if (automationMatch && request.method === "GET") {
          const automationId = decodeURIComponent(automationMatch[1]!);
          const automation = await automationService.get(automationId);

          if (!automation) {
            return errorResponse("Automation not found", 404);
          }

          return json<AutomationResponse>({ automation });
        }

        if (automationMatch && request.method === "PUT") {
          const automationId = decodeURIComponent(automationMatch[1]!);
          const body = await readJson<UpdateAutomationRequest>(request);

          try {
            const automation = await automationService.update(automationId, body);
            return json<AutomationResponse>({ automation });
          } catch (error) {
            if (error instanceof Error && error.message === "Automation not found.") {
              return errorResponse(error.message, 404);
            }

            throw error;
          }
        }

        if (automationMatch && request.method === "DELETE") {
          const automationId = decodeURIComponent(automationMatch[1]!);
          const deleted = await automationService.delete(automationId);

          if (!deleted) {
            return errorResponse("Automation not found", 404);
          }

          return new Response(null, { status: 204 });
        }

        if (automationRunMatch && request.method === "POST") {
          const automationId = decodeURIComponent(automationRunMatch[1]!);
          const result = await agent.runAutomation(automationId);

          if (result.skipped) {
            return errorResponse(result.error ?? "Automation run skipped.", 409);
          }

          const runs = await automationService.listRuns(automationId, 1);
          const run = runs[0];

          if (!run) {
            return errorResponse("Automation run record not found.", 500);
          }

          return json<RunAutomationResponse>({ run });
        }

        if (automationRunsMatch && request.method === "GET") {
          const automationId = decodeURIComponent(automationRunsMatch[1]!);

          try {
            const runs = await automationService.listRuns(automationId);
            return json<ListAutomationRunsResponse>({ runs });
          } catch (error) {
            if (error instanceof Error && error.message === "Automation not found.") {
              return errorResponse(error.message, 404);
            }

            throw error;
          }
        }

        if (request.method === "GET" && url.pathname === "/v1/tasks") {
          const tasks = await taskService.list();
          return json<ListTasksResponse>({ tasks });
        }

        if (request.method === "POST" && url.pathname === "/v1/tasks/draft-prompt") {
          const body = await readJson<DraftTaskPromptRequest>(request);

          try {
            const prompt = await agent.draftTaskPrompt(body.title, body.description);
            return json<DraftTaskPromptResponse>({ prompt });
          } catch (error) {
            if (error instanceof Error && error.message === "Task title is required.") {
              return errorResponse(error.message, 400);
            }

            throw error;
          }
        }

        if (request.method === "POST" && url.pathname === "/v1/tasks") {
          const body = await readJson<CreateTaskRequest>(request);

          try {
            const task = await taskService.create(body, body.profileId);
            return json<TaskResponse>({ task }, 201);
          } catch (error) {
            if (error instanceof Error) {
              if (error.message === "Profile not found.") {
                return errorResponse(error.message, 400);
              }

              if (
                error.message === "Task title is required." ||
                error.message === "Task prompt is required." ||
                error.message.startsWith("Invalid task status:")
              ) {
                return errorResponse(error.message, 400);
              }
            }

            throw error;
          }
        }

        const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
        const taskRunsMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/runs$/);
        const taskMessagesMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/messages$/);
        const taskRunMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/run$/);

        if (taskMatch && request.method === "GET") {
          const taskId = decodeURIComponent(taskMatch[1]!);
          const task = await taskService.get(taskId);

          if (!task) {
            return errorResponse("Task not found.", 404);
          }

          return json<TaskResponse>({ task });
        }

        if (taskMatch && request.method === "PUT") {
          const taskId = decodeURIComponent(taskMatch[1]!);
          const body = await readJson<UpdateTaskRequest>(request);

          try {
            const task = await taskService.update(taskId, body);
            return json<TaskResponse>({ task });
          } catch (error) {
            if (error instanceof Error) {
              if (error.message === "Task not found.") {
                return errorResponse(error.message, 404);
              }

              if (
                error.message === "Profile not found." ||
                error.message === "Task title is required." ||
                error.message === "Task prompt is required." ||
                error.message.startsWith("Invalid task status:")
              ) {
                return errorResponse(error.message, 400);
              }
            }

            throw error;
          }
        }

        if (taskMatch && request.method === "DELETE") {
          const taskId = decodeURIComponent(taskMatch[1]!);
          const deleted = await taskService.delete(taskId);

          if (!deleted) {
            return errorResponse("Task not found.", 404);
          }

          return new Response(null, { status: 204 });
        }

        if (taskRunMatch && request.method === "POST") {
          const taskId = decodeURIComponent(taskRunMatch[1]!);
          const task = await taskService.get(taskId);

          if (!task) {
            return errorResponse("Task not found.", 404);
          }

          if (task.status !== "in_progress") {
            await taskService.update(taskId, { status: "in_progress" }, { triggerRun: false });
          }

          const result = await agent.runTask(taskId);

          if (result.skipped) {
            return errorResponse(result.error ?? "Task run skipped.", 409);
          }

          const runs = await taskService.listRuns(taskId, 1);
          const run = runs[0];

          if (!run) {
            return errorResponse("Task run record not found.", 500);
          }

          return json<RunTaskResponse>({ run });
        }

        if (taskRunsMatch && request.method === "GET") {
          const taskId = decodeURIComponent(taskRunsMatch[1]!);
          const task = await taskService.get(taskId);

          if (!task) {
            return errorResponse("Task not found.", 404);
          }

          const runs = await taskService.listRuns(taskId);
          return json<ListTaskRunsResponse>({ runs });
        }

        if (taskMessagesMatch && request.method === "GET") {
          const taskId = decodeURIComponent(taskMessagesMatch[1]!);
          const result = await agent.getTaskChatMessages(taskId);

          if (!result) {
            return errorResponse("Task not found.", 404);
          }

          return json<TaskMessagesResponse>({
            sessionId: result.sessionId,
            messages: result.messages,
          });
        }

        if (webDistDir) {
          const staticResponse = tryServeStaticWeb(request, webDistDir);

          if (staticResponse) {
            return staticResponse;
          }
        }

        return errorResponse("Not found", 404);
      } catch (err) {
        if (err instanceof TinyClawApiError) {
          return errorResponse(err.message, err.status);
        }

        return errorResponse(formatServerError(err), 500);
      }
    },
  };
}

function parseChannel(value: string | undefined): AgentChannel {
  if (value === "cli" || value === "web" || value === "telegram" || value === "whatsapp") {
    return value;
  }

  throw new TinyClawApiError("Invalid channel. Expected cli, web, or telegram.", 400);
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status });
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message } satisfies ApiErrorResponse, { status });
}

function streamMessage(
  session: AgentChatSession,
  input: SendMessageInput,
  onComplete?: () => void,
): Response {
  const encoder = new TextEncoder();
  const keepaliveIntervalMs = 4_000;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, keepaliveIntervalMs);

      try {
        const reply = await session.sendStream(input, {
          onChunk: (delta) => send({ type: "chunk", delta }),
          onThinking: (delta) => send({ type: "thinking", delta }),
          onToolStart: (event) =>
            send({
              type: "tool_start",
              toolCallId: event.toolCallId,
              tool: event.tool,
              input: event.input,
            }),
          onToolEnd: (event) => {
            send({
              type: "tool_end",
              toolCallId: event.toolCallId,
              tool: event.tool,
              result: event.result,
            });

            if (event.tool === "todo_write") {
              const todos = readTodosFromToolResult(event.result);

              if (todos) {
                send({ type: "todos_updated", todos });
              }
            }
          },
        });

        send({ type: "done", reply });
      } catch (error) {
        send({ type: "error", error: formatServerError(error) });
      } finally {
        clearInterval(keepalive);
        controller.close();
        onComplete?.();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function readTodosFromToolResult(result: unknown): AgentTodo[] | null {
  if (typeof result !== "object" || result === null || !("todos" in result)) {
    return null;
  }

  const todos = (result as { todos?: unknown }).todos;

  if (!Array.isArray(todos)) {
    return null;
  }

  const parsed: AgentTodo[] = [];

  for (const item of todos) {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const record = item as Record<string, unknown>;

    if (
      typeof record.id !== "string" ||
      typeof record.content !== "string" ||
      typeof record.status !== "string"
    ) {
      return null;
    }

    parsed.push({
      id: record.id,
      content: record.content,
      status: record.status as AgentTodo["status"],
    });
  }

  return parsed;
}

function matchProviderRoute(pathname: string): string | null {
  const match = pathname.match(/^\/v1\/providers\/([^/]+)$/);
  return match?.[1] ?? null;
}
