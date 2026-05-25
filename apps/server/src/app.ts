import {
  formatServerError,
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
  type TimezoneSettingsResponse,
  type UpdateAutomationRequest,
  type UpdateTimezoneRequest,
  type HealthResponse,
  type InitSoulResponse,
  type ListProfilesResponse,
  type ListToolsResponse,
  type ListSessionsResponse,
  type ModelsResponse,
  type ProfileResponse,
  type SendMessageRequest,
  type SendMessageResponse,
  type SessionMessagesResponse,
  type SetModelRequest,
  type SetModelResponse,
  type ConfigureProviderRequest,
  type ConfigureProviderResponse,
  type SoulStackResponse,
  type SoulStatusResponse,
  type StreamEvent,
  type SystemStatusResponse,
  type UpdateProfileRequest,
  type UpdateSoulFileRequest,
} from "@tinyclaw/core";
import type { AgentChatSession } from "@tinyclaw/agent";
import { serializeOpenApiSpec } from "./openapi/build-spec";
import type { AgentService } from "./services/agent-service";
import type { AutomationService } from "./services/automation-service";
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
  systemStatus: SystemStatusService;
  webDistDir?: string | null;
}

export function createApp(options: ServerOptions) {
  const { agent, automationService, systemStatus, webDistDir = null } = options;

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
          const wantsStream =
            body.stream === true ||
            url.searchParams.get("stream") === "true" ||
            request.headers.get("Accept")?.includes("text/event-stream");

          if (wantsStream) {
            return streamMessage(session, body.message);
          }

          const reply = await session.send(body.message);

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

        if (webDistDir) {
          const staticResponse = tryServeStaticWeb(request, webDistDir);

          if (staticResponse) {
            return staticResponse;
          }
        }

        return errorResponse("Not found", 404);
      } catch (err) {
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

function streamMessage(session: AgentChatSession, message: string): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        const reply = await session.sendStream(message, {
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
