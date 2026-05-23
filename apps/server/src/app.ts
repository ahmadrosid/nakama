import {
  TINYCLAW_API_VERSION,
  type AgentChannel,
  type ApiErrorResponse,
  type AssignToolRequest,
  type CreateProfileRequest,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type CreateToolRequest,
  type DraftAutomationRequest,
  type DraftAutomationResponse,
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
  type SoulStackResponse,
  type SoulStatusResponse,
  type StreamEvent,
  type UpdateProfileRequest,
  type UpdateSoulFileRequest,
} from "@tinyclaw/core";
import type { AgentChatSession } from "@tinyclaw/agent";
import { serializeOpenApiSpec } from "./openapi/build-spec";
import type { AgentService } from "./services/agent-service";

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
}

export function createApp(options: ServerOptions) {
  const { agent } = options;

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

        if (request.method === "GET" && url.pathname === "/v1/models") {
          return json<ModelsResponse>(agent.getModels());
        }

        if (request.method === "PUT" && url.pathname === "/v1/settings/model") {
          const body = await readJson<SetModelRequest>(request);
          const result = await agent.setModel(body.model);

          return json<SetModelResponse>(result);
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

        return errorResponse("Not found", 404);
      } catch (err) {
        return errorResponse(formatError(err), 500);
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
        send({ type: "error", error: formatError(error) });
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
