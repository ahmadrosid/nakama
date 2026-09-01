import { createRoute, z } from "@hono/zod-openapi";
import type { AgentChatSession } from "@nakama/agent";
import type {
  BranchSessionRequest,
  BranchSessionResponse,
  CompactionResponse,
  CompactSessionRequest,
  CreateSessionRequest,
  CreateSessionResponse,
  ListSessionsResponse,
  SendMessageRequest,
  SendMessageResponse,
  SessionMessagesResponse,
  SessionStatusResponse,
  UpdateSessionRequest,
} from "@nakama/core";
import { AGENT_CHANNELS, formatServerError } from "@nakama/core";
import { resolveRequestClientOrigin } from "../../services/composio-callback-url";
import { sessionTurnRegistry } from "../../services/session-turn-registry";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
} from "../org-guards";
import {
  errorResponse,
  json,
  parseChannel,
  readJson,
  readOptionalJson,
  streamMessage,
  streamTurnSubscribe,
} from "../shared";
import type { HonoApp } from "../types";

export function registerSessionRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent } = options;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const agentChannelSchema = z.enum(AGENT_CHANNELS).openapi("AgentChannel");
  const createSessionRequestSchema = z
    .object({
      channel: agentChannelSchema,
      model: z.string().trim().min(1).optional(),
      profileId: z.string().optional(),
    })
    .openapi("CreateSessionRequest");
  const createSessionResponseSchema = z
    .object({ sessionId: z.string() })
    .openapi("CreateSessionResponse");
  const sessionSummarySchema = z
    .object({
      channel: agentChannelSchema,
      createdAt: z.string().optional(),
      id: z.string(),
      messageCount: z.number().optional(),
      preview: z.string().nullable().optional(),
      profileId: z.string(),
      title: z.string().nullable().optional(),
      updatedAt: z.string().optional(),
    })
    .passthrough()
    .openapi("SessionSummary");
  const listSessionsResponseSchema = z
    .object({
      sessions: z.array(sessionSummarySchema),
    })
    .openapi("ListSessionsResponse");
  const compactSessionRequestSchema = z
    .object({ force: z.boolean().optional() })
    .openapi("CompactSessionRequest");
  const compactionResponseSchema = z
    .object({
      action: z.enum(["none", "pruned", "summarized"]),
      messagesAfter: z.number(),
      messagesBefore: z.number(),
      prunedTokens: z.number().optional(),
    })
    .openapi("CompactionResponse");
  const sessionMessageMetaSchema = z
    .object({
      createdAt: z.string(),
      id: z.string(),
      seq: z.number(),
    })
    .openapi("SessionMessageMeta");
  const agentTodoSchema = z
    .object({
      content: z.string(),
      id: z.string(),
      status: z.string(),
    })
    .openapi("AgentTodo");
  const agentQuestionChoiceSchema = z
    .object({
      id: z.string(),
      label: z.string(),
    })
    .openapi("AgentQuestionChoice");
  const agentQuestionItemSchema = z
    .object({
      allowCustomAnswer: z.boolean(),
      choices: z.array(agentQuestionChoiceSchema),
      id: z.string(),
      placeholder: z.string().optional(),
      prompt: z.string(),
    })
    .openapi("AgentQuestionItem");
  const agentQuestionnaireSchema = z
    .object({
      id: z.string(),
      questions: z.array(agentQuestionItemSchema),
      title: z.string(),
    })
    .openapi("AgentQuestionnaire");
  const sessionMessagesResponseSchema = z
    .object({
      channel: agentChannelSchema,
      messageMeta: z.array(sessionMessageMetaSchema),
      messages: z.array(z.object({}).passthrough()),
      model: z.string().nullable(),
      questionnaire: agentQuestionnaireSchema.nullable(),
      todos: z.array(agentTodoSchema),
    })
    .openapi("SessionMessagesResponse");
  const branchSessionRequestSchema = z
    .object({ messageIndex: z.number() })
    .openapi("BranchSessionRequest");
  const branchSessionResponseSchema = z
    .object({ sessionId: z.string() })
    .openapi("BranchSessionResponse");
  const updateSessionRequestSchema = z
    .object({ model: z.string().trim().min(1).nullable() })
    .openapi("UpdateSessionRequest");
  const sendMessageRequestSchema = z
    .object({
      clientOrigin: z.string().optional(),
      documents: z.array(z.object({}).passthrough()).optional(),
      images: z.array(z.object({}).passthrough()).optional(),
      message: z.string(),
      stream: z.boolean().optional(),
    })
    .openapi("SendMessageRequest");
  const sendMessageResponseSchema = z
    .object({ reply: z.string() })
    .openapi("SendMessageResponse");
  const sessionIdParamSchema = z.object({
    sessionId: z.string().openapi({ param: { in: "path", name: "sessionId" } }),
  });
  const sessionListQuerySchema = z.object({
    channel: agentChannelSchema.optional(),
    profileId: z.string().optional(),
  });
  const streamQuerySchema = z.object({
    stream: z.enum(["true", "false"]).optional(),
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createSession",
      path: "/v1/sessions",
      request: {
        body: {
          content: {
            "application/json": { schema: createSessionRequestSchema },
          },
          required: true,
        },
      },
      responses: {
        201: {
          content: {
            "application/json": { schema: createSessionResponseSchema },
          },
          description: "Session created",
        },
      },
      summary: "Create a chat session",
      tags: ["Chat"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listSessions",
      path: "/v1/sessions",
      request: { query: sessionListQuerySchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: listSessionsResponseSchema },
          },
          description: "Sessions",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "List chat sessions",
      tags: ["Chat"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "patch",
      operationId: "updateSession",
      path: "/v1/sessions/{sessionId}",
      request: {
        body: {
          content: {
            "application/json": { schema: updateSessionRequestSchema },
          },
          required: true,
        },
        params: sessionIdParamSchema,
      },
      responses: {
        204: { description: "Session updated" },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid model",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Response in progress",
        },
      },
      summary: "Update a chat session",
      tags: ["Chat"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteSession",
      path: "/v1/sessions/{sessionId}",
      request: { params: sessionIdParamSchema },
      responses: {
        204: { description: "Deleted" },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete or purge a session",
      tags: ["Chat"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "compactSession",
      path: "/v1/sessions/{sessionId}/compact",
      request: {
        body: {
          content: {
            "application/json": { schema: compactSessionRequestSchema },
          },
          required: false,
        },
        params: sessionIdParamSchema,
      },
      responses: {
        200: {
          content: { "application/json": { schema: compactionResponseSchema } },
          description: "Compaction result",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Compact a session",
      tags: ["Chat"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getSessionMessages",
      path: "/v1/sessions/{sessionId}/messages",
      request: { params: sessionIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: sessionMessagesResponseSchema },
          },
          description: "Messages",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get session messages",
      tags: ["Chat"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "branchSession",
      path: "/v1/sessions/{sessionId}/branch",
      request: {
        body: {
          content: {
            "application/json": { schema: branchSessionRequestSchema },
          },
          required: true,
        },
        params: sessionIdParamSchema,
      },
      responses: {
        201: {
          content: {
            "application/json": { schema: branchSessionResponseSchema },
          },
          description: "Branched session",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Branch a session from a message index",
      tags: ["Chat"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "sendMessage",
      path: "/v1/sessions/{sessionId}/messages",
      request: {
        body: {
          content: { "application/json": { schema: sendMessageRequestSchema } },
          required: true,
        },
        params: sessionIdParamSchema,
        query: streamQuerySchema,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: sendMessageResponseSchema },
          },
          description: "Assistant reply",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Send a message to a session",
      tags: ["Chat"],
    })
  );

  app.post("/v1/sessions", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const parsedBody = createSessionRequestSchema.safeParse(
      await readJson<unknown>(c.req.raw)
    );
    if (!parsedBody.success) {
      return errorResponse("Invalid session request.", 400);
    }
    const body: CreateSessionRequest = parsedBody.data;
    const channel = parseChannel(body.channel);
    const sessionId = await agent.createSession(
      orgId,
      channel,
      body.profileId,
      auth.user.id,
      {
        excludeSuperBot: auth.mode === "local-token" && channel !== "cli",
        isPlatformAdmin: auth.isPlatformAdmin,
        model: body.model,
        orgRole: auth.orgRole,
      }
    );
    return json<CreateSessionResponse>({ sessionId }, 201);
  });

  app.get("/v1/sessions", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = c.req.query("profileId")?.trim();
    const channel = parseChannel(c.req.query("channel"));

    if (!profileId) {
      return errorResponse("profileId is required.", 400);
    }

    return json<ListSessionsResponse>(
      await agent.listSessions(orgId, profileId, channel)
    );
  });

  app.delete("/v1/sessions/:sessionId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const purge = c.req.query("purge") === "true";
    const cleared = purge
      ? await agent.purgeSession(sessionId, orgId)
      : await agent.clearSession(sessionId, orgId);

    if (!cleared) {
      return errorResponse("Session not found", 404);
    }

    return new Response(null, { status: 204 });
  });

  app.patch("/v1/sessions/:sessionId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const parsedBody = updateSessionRequestSchema.safeParse(
      await readJson<unknown>(c.req.raw)
    );
    if (!parsedBody.success) {
      return errorResponse("Invalid session model.", 400);
    }
    const body: UpdateSessionRequest = parsedBody.data;
    const updated = await agent.updateSessionModel(
      sessionId,
      orgId,
      body.model
    );

    if (!updated) {
      return errorResponse("Session not found", 404);
    }

    return new Response(null, { status: 204 });
  });

  app.post("/v1/sessions/:sessionId/compact", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const body = await readOptionalJson<CompactSessionRequest>(c.req.raw, {});
    const result = await agent.compactSession(
      sessionId,
      {
        force: body.force ?? false,
      },
      orgId
    );

    if (!result) {
      return errorResponse("Session not found", 404);
    }

    return json<CompactionResponse>(result);
  });

  app.get("/v1/sessions/:sessionId/messages", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const result = await agent.getSessionMessages(sessionId, orgId);

    if (!result) {
      return errorResponse("Session not found", 404);
    }

    const todos = (await agent.getSessionTodos(sessionId, orgId)) ?? [];
    const questionnaire =
      (await agent.getSessionQuestionnaire(sessionId, orgId)) ?? null;
    return json<SessionMessagesResponse>({
      channel: result.channel,
      contextUsage: result.contextUsage,
      messageMeta: result.messageMeta,
      messages: result.messages,
      model: result.model,
      questionnaire,
      todos,
    });
  });

  app.get("/v1/sessions/:sessionId/status", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const result = await agent.getSessionMessages(sessionId, orgId);

    if (!result) {
      return errorResponse("Session not found", 404);
    }

    const status = sessionTurnRegistry.getStatus(sessionId);
    return json<SessionStatusResponse>({
      active: status.active,
      ...(status.startedAt ? { startedAt: status.startedAt } : {}),
    });
  });

  app.get("/v1/sessions/:sessionId/stream", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const result = await agent.getSessionMessages(sessionId, orgId);

    if (!result) {
      return errorResponse("Session not found", 404);
    }

    const response = streamTurnSubscribe(sessionId);

    if (!response) {
      return new Response(null, { status: 204 });
    }

    return response;
  });

  app.post("/v1/sessions/:sessionId/branch", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const body = await readJson<BranchSessionRequest>(c.req.raw);
    const result = await agent.branchSession(
      sessionId,
      body.messageIndex,
      orgId
    );

    if (!result) {
      return errorResponse("Session not found", 404);
    }

    return json<BranchSessionResponse>(result, 201);
  });

  app.post("/v1/sessions/:sessionId/messages", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const sessionId = decodeURIComponent(c.req.param("sessionId"));

    const turnStarted = await agent.beginSessionTurn(sessionId, orgId);
    if (turnStarted === null) {
      return errorResponse("Session not found", 404);
    }
    if (!turnStarted) {
      return errorResponse(
        "A response is already in progress for this session.",
        409
      );
    }

    let session: AgentChatSession;
    let body: SendMessageRequest;
    try {
      const resolvedSession = await agent.resolveSession(sessionId, orgId);
      if (!resolvedSession) {
        sessionTurnRegistry.cancelTurn(sessionId);
        return errorResponse("Session not found", 404);
      }
      session = resolvedSession;
      body = await readJson<SendMessageRequest>(c.req.raw);
    } catch (error) {
      sessionTurnRegistry.cancelTurn(sessionId);
      throw error;
    }

    const clientOrigin = resolveRequestClientOrigin(
      c.req.raw,
      body.clientOrigin
    );
    const input = {
      documents: body.documents,
      images: body.images,
      message: body.message ?? "",
      ...(clientOrigin ? { clientOrigin } : {}),
    };
    const wantsStream =
      body.stream === true ||
      c.req.query("stream") === "true" ||
      c.req.header("Accept")?.includes("text/event-stream");

    if (wantsStream) {
      return streamMessage(
        sessionId,
        session,
        input,
        (terminal) => {
          agent.scheduleSessionTitleGeneration(sessionId);
          if (terminal.type === "done") {
            agent.schedulePostTurnSkillReview(sessionId);
          }
        },
        c.req.raw.signal
      );
    }

    try {
      const reply = await session.send(input);
      const contextUsage = session.getContextUsage() ?? undefined;
      sessionTurnRegistry.endTurn(sessionId, {
        reply,
        type: "done",
        ...(contextUsage ? { contextUsage } : {}),
      });
      agent.scheduleSessionTitleGeneration(sessionId);
      agent.schedulePostTurnSkillReview(sessionId);
      return json<SendMessageResponse>({
        reply,
        ...(contextUsage ? { contextUsage } : {}),
      });
    } catch (error) {
      const message = formatServerError(error);
      sessionTurnRegistry.endTurn(sessionId, { error: message, type: "error" });
      return errorResponse(message, 500);
    }
  });
}
