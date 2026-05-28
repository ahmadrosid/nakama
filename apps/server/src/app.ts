import {
  formatServerError,
  TinyClawApiError,
  TINYCLAW_API_VERSION,
  type AgentChannel,
  type ApiErrorResponse,
  type AssignToolRequest,
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
  type TimezoneSettingsResponse,
  type ListTimezonesResponse,
  type UpdateAutomationRequest,
  type UpdateTimezoneRequest,
  type UpdateTelegramSettingsRequest,
  type HealthResponse,
  type InitSoulResponse,
  type InitUserContextResponse,
  type ListProfilesResponse,
  type ListToolsResponse,
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
  type CompactSessionRequest,
  type CompactionResponse,
  type SoulStackResponse,
  type SoulStatusResponse,
  type StreamEvent,
  type SystemStatusResponse,
  type UpdateProfileRequest,
  type UpdateSoulFileRequest,
  type UpdateUserContextRequest,
  type ImageAttachment,
  type UserContextStatusResponse,
  type CreateTaskRequest,
  type UpdateTaskRequest,
  type ListTasksResponse,
  type TaskResponse,
  type RunTaskResponse,
  type ListTaskRunsResponse,
  type TaskMessagesResponse,
} from "@tinyclaw/core";
import type { AgentChatSession } from "@tinyclaw/agent";
import { serializeOpenApiSpec } from "./openapi/build-spec";
import type { AgentService } from "./services/agent-service";
import type { AutomationService } from "./services/automation-service";
import type { TaskService } from "./services/task-service";
import { getTimezoneCatalog } from "./services/timezone-catalog-service";
import { SystemStatusService } from "./services/system-status-service";
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
  webDistDir?: string | null;
}

export function createApp(options: ServerOptions) {
  const { agent, automationService, taskService, systemStatus, webDistDir = null } = options;

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
          return json<HealthResponse>({
            ok: true,
            apiVersion: TINYCLAW_API_VERSION,
            providerConfigured: agent.providerConfigured,
          });
        }

        if (request.method === "GET" && url.pathname === "/v1/system/status") {
          return json<SystemStatusResponse>(systemStatus.getStatus());
        }

        if (request.method === "GET" && url.pathname === "/v1/models") {
          return json<ModelsResponse>(agent.getModels());
        }

        if (request.method === "PUT" && url.pathname === "/v1/settings/model") {
          const body = await readJson<SetModelRequest>(request);
          const result = await agent.setModel(body.model);

          return json<SetModelResponse>(result);
        }

        if (request.method === "PUT" && url.pathname === "/v1/settings/provider") {
          const body = await readJson<ConfigureProviderRequest>(request);
          const result = await agent.configureProvider(body.apiKey, body.model);

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

        if (request.method === "GET" && url.pathname === "/v1/tools") {
          return json<ListToolsResponse>(await agent.listTools());
        }

        if (request.method === "POST" && url.pathname === "/v1/tools") {
          const body = await readJson<CreateToolRequest>(request);
          return json(await agent.createTool(body), 201);
        }

        const toolMatch = url.pathname.match(/^\/v1\/tools\/([^/]+)$/);

        if (toolMatch && request.method === "DELETE") {
          const toolId = decodeURIComponent(toolMatch[1]!);
          await agent.deleteTool(toolId);
          return new Response(null, { status: 204 });
        }

        if (request.method === "GET" && url.pathname === "/v1/soul") {
          const includeContents = url.searchParams.get("contents") === "true";
          return json<SoulStatusResponse>(await agent.getGlobalSoulStatus(includeContents));
        }

        if (request.method === "GET" && url.pathname === "/v1/soul/stack") {
          return json<SoulStackResponse>(await agent.getGlobalSoulStack());
        }

        if (request.method === "POST" && url.pathname === "/v1/soul/init") {
          return json<InitSoulResponse>(await agent.initGlobalSoul(), 201);
        }

        const globalSoulFileMatch = url.pathname.match(/^\/v1\/soul\/files\/([^/]+)$/);

        if (globalSoulFileMatch && request.method === "PUT") {
          const fileKey = decodeURIComponent(globalSoulFileMatch[1]!);
          const body = await readJson<UpdateSoulFileRequest>(request);
          await agent.writeGlobalSoulFile(fileKey, body);
          return new Response(null, { status: 204 });
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
          const messages = await agent.getSessionMessages(sessionId);

          if (!messages) {
            return errorResponse("Session not found", 404);
          }

          return json<SessionMessagesResponse>({ messages });
        }

        if (messageMatch && request.method === "POST") {
          const sessionId = decodeURIComponent(messageMatch[1]!);
          const session = await agent.resolveSession(sessionId);

          if (!session) {
            return errorResponse("Session not found", 404);
          }

          const body = await readJson<SendMessageRequest>(request);
          const input = { message: body.message ?? "", images: body.images };
          const wantsStream =
            body.stream === true ||
            url.searchParams.get("stream") === "true" ||
            request.headers.get("Accept")?.includes("text/event-stream");

          if (wantsStream) {
            return streamMessage(session, input);
          }

          const reply = await session.send(input);

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
  if (value === "cli" || value === "web" || value === "telegram") {
    return value;
  }

  throw new Error("Invalid channel. Expected cli, web, or telegram.");
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

function streamMessage(session: AgentChatSession, input: SendMessageInput): Response {
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
          onToolStart: (event) =>
            send({
              type: "tool_start",
              toolCallId: event.toolCallId,
              tool: event.tool,
              input: event.input,
            }),
          onToolEnd: (event) =>
            send({
              type: "tool_end",
              toolCallId: event.toolCallId,
              tool: event.tool,
              result: event.result,
            }),
        });

        send({ type: "done", reply });
      } catch (error) {
        send({ type: "error", error: formatServerError(error) });
      } finally {
        clearInterval(keepalive);
        controller.close();
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
