import { createRoute, z } from "@hono/zod-openapi";
import type {
  BranchSessionRequest,
  BranchSessionResponse,
  CompactSessionRequest,
  CompactionResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  ListSessionsResponse,
  SendMessageRequest,
  SendMessageResponse,
  SessionMessagesResponse,
} from "@nakama/core";
import {
  errorResponse,
  json,
  parseChannel,
  readJson,
  streamMessage,
  getRequestAuth,
} from "../shared";
import { requireActiveOrgIdFromContext, requireNotViewerFromContext } from "../org-guards";
import { resolveRequestClientOrigin } from "../../services/composio-callback-url";
import type { HonoApp } from "../types";

export function registerSessionRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const agentChannelSchema = z.enum(["web", "cli", "telegram", "whatsapp", "discord", "automation", "task", "subagent"]).openapi("AgentChannel");
  const createSessionRequestSchema = z.object({
    channel: agentChannelSchema,
    profileId: z.string().optional(),
  }).openapi("CreateSessionRequest");
  const createSessionResponseSchema = z.object({ sessionId: z.string() }).openapi("CreateSessionResponse");
  const sessionSummarySchema = z.object({
    id: z.string(),
    profileId: z.string(),
    channel: agentChannelSchema,
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    messageCount: z.number().optional(),
    title: z.string().nullable().optional(),
    preview: z.string().nullable().optional(),
  }).passthrough().openapi("SessionSummary");
  const listSessionsResponseSchema = z.object({
    sessions: z.array(sessionSummarySchema),
  }).openapi("ListSessionsResponse");
  const compactSessionRequestSchema = z.object({ force: z.boolean().optional() }).openapi("CompactSessionRequest");
  const compactionResponseSchema = z.object({
    action: z.enum(["none", "pruned", "summarized"]),
    messagesBefore: z.number(),
    messagesAfter: z.number(),
    prunedTokens: z.number().optional(),
  }).openapi("CompactionResponse");
  const sessionMessageMetaSchema = z.object({
    id: z.string(),
    seq: z.number(),
    createdAt: z.string(),
  }).openapi("SessionMessageMeta");
  const agentTodoSchema = z.object({
    id: z.string(),
    content: z.string(),
    status: z.string(),
  }).openapi("AgentTodo");
  const agentQuestionChoiceSchema = z.object({
    id: z.string(),
    label: z.string(),
  }).openapi("AgentQuestionChoice");
  const agentQuestionItemSchema = z.object({
    id: z.string(),
    prompt: z.string(),
    allowCustomAnswer: z.boolean(),
    placeholder: z.string().optional(),
    choices: z.array(agentQuestionChoiceSchema),
  }).openapi("AgentQuestionItem");
  const agentQuestionnaireSchema = z.object({
    id: z.string(),
    title: z.string(),
    questions: z.array(agentQuestionItemSchema),
  }).openapi("AgentQuestionnaire");
  const sessionMessagesResponseSchema = z.object({
    channel: agentChannelSchema,
    messages: z.array(z.object({}).passthrough()),
    messageMeta: z.array(sessionMessageMetaSchema),
    todos: z.array(agentTodoSchema),
    questionnaire: agentQuestionnaireSchema.nullable(),
  }).openapi("SessionMessagesResponse");
  const branchSessionRequestSchema = z.object({ messageIndex: z.number() }).openapi("BranchSessionRequest");
  const branchSessionResponseSchema = z.object({ sessionId: z.string() }).openapi("BranchSessionResponse");
  const sendMessageRequestSchema = z.object({
    message: z.string(),
    images: z.array(z.object({}).passthrough()).optional(),
    documents: z.array(z.object({}).passthrough()).optional(),
    stream: z.boolean().optional(),
    clientOrigin: z.string().optional(),
  }).openapi("SendMessageRequest");
  const sendMessageResponseSchema = z.object({ reply: z.string() }).openapi("SendMessageResponse");
  const sessionIdParamSchema = z.object({
    sessionId: z.string().openapi({ param: { name: "sessionId", in: "path" } }),
  });
  const sessionListQuerySchema = z.object({
    profileId: z.string().optional(),
    channel: agentChannelSchema.optional(),
  });
  const streamQuerySchema = z.object({
    stream: z.enum(["true", "false"]).optional(),
  });

  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/sessions",
    tags: ["Chat"],
    summary: "Create a chat session",
    operationId: "createSession",
    request: { body: { required: true, content: { "application/json": { schema: createSessionRequestSchema } } } },
    responses: {
      201: { description: "Session created", content: { "application/json": { schema: createSessionResponseSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/sessions",
    tags: ["Chat"],
    summary: "List chat sessions",
    operationId: "listSessions",
    request: { query: sessionListQuerySchema },
    responses: {
      200: { description: "Sessions", content: { "application/json": { schema: listSessionsResponseSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/sessions/{sessionId}",
    tags: ["Chat"],
    summary: "Delete or purge a session",
    operationId: "deleteSession",
    request: { params: sessionIdParamSchema },
    responses: {
      204: { description: "Deleted" },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/sessions/{sessionId}/compact",
    tags: ["Chat"],
    summary: "Compact a session",
    operationId: "compactSession",
    request: { params: sessionIdParamSchema, body: { required: false, content: { "application/json": { schema: compactSessionRequestSchema } } } },
    responses: {
      200: { description: "Compaction result", content: { "application/json": { schema: compactionResponseSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/sessions/{sessionId}/messages",
    tags: ["Chat"],
    summary: "Get session messages",
    operationId: "getSessionMessages",
    request: { params: sessionIdParamSchema },
    responses: {
      200: { description: "Messages", content: { "application/json": { schema: sessionMessagesResponseSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/sessions/{sessionId}/branch",
    tags: ["Chat"],
    summary: "Branch a session from a message index",
    operationId: "branchSession",
    request: { params: sessionIdParamSchema, body: { required: true, content: { "application/json": { schema: branchSessionRequestSchema } } } },
    responses: {
      201: { description: "Branched session", content: { "application/json": { schema: branchSessionResponseSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/sessions/{sessionId}/messages",
    tags: ["Chat"],
    summary: "Send a message to a session",
    operationId: "sendMessage",
    request: { params: sessionIdParamSchema, query: streamQuerySchema, body: { required: true, content: { "application/json": { schema: sendMessageRequestSchema } } } },
    responses: {
      200: { description: "Assistant reply", content: { "application/json": { schema: sendMessageResponseSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));

  app.post("/v1/sessions", async (c) => {
    const auth = getRequestAuth(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<CreateSessionRequest>(c.req.raw);
    const channel = parseChannel(body.channel);
    const sessionId = await agent.createSession(
      orgId,
      channel,
      body.profileId,
      auth.user.id,
      {
        orgRole: auth.orgRole,
        isPlatformAdmin: auth.isPlatformAdmin,
        excludeSuperBot: auth.mode === "local-token" && channel !== "cli",
      },
    );
    return json<CreateSessionResponse>({ sessionId }, 201);
  });

  app.get("/v1/sessions", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = c.req.query("profileId")?.trim();
    const channel = parseChannel(c.req.query("channel") ?? "web");

    if (!profileId) {
      return errorResponse("profileId is required.", 400);
    }

    return json<ListSessionsResponse>(await agent.listSessions(orgId, profileId, channel));
  });

  app.delete("/v1/sessions/:sessionId", async (c) => {
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const purge = c.req.query("purge") === "true";
    const cleared = purge
      ? await agent.purgeSession(sessionId)
      : await agent.clearSession(sessionId);

    if (!cleared) {
      return errorResponse("Session not found", 404);
    }

    return new Response(null, { status: 204 });
  });

  app.post("/v1/sessions/:sessionId/compact", async (c) => {
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const body = await readJson<CompactSessionRequest>(c.req.raw).catch(() => ({}));
    const result = await agent.compactSession(sessionId, {
      force: body.force ?? false,
    });

    if (!result) {
      return errorResponse("Session not found", 404);
    }

    return json<CompactionResponse>(result);
  });

  app.get("/v1/sessions/:sessionId/messages", async (c) => {
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const result = await agent.getSessionMessages(sessionId);

    if (!result) {
      return errorResponse("Session not found", 404);
    }

    const todos = (await agent.getSessionTodos(sessionId)) ?? [];
    const questionnaire = (await agent.getSessionQuestionnaire(sessionId)) ?? null;
    return json<SessionMessagesResponse>({
      channel: result.channel,
      messages: result.messages,
      messageMeta: result.messageMeta,
      todos,
      questionnaire,
    });
  });

  app.post("/v1/sessions/:sessionId/branch", async (c) => {
    try {
      const sessionId = decodeURIComponent(c.req.param("sessionId"));
      const body = await readJson<BranchSessionRequest>(c.req.raw);
      const result = await agent.branchSession(sessionId, body.messageIndex);

      if (!result) {
        return errorResponse("Session not found", 404);
      }

      return json<BranchSessionResponse>(result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.post("/v1/sessions/:sessionId/messages", async (c) => {
    requireNotViewerFromContext(c);
    const sessionId = decodeURIComponent(c.req.param("sessionId"));
    const session = await agent.resolveSession(sessionId);

    if (!session) {
      return errorResponse("Session not found", 404);
    }

    const body = await readJson<SendMessageRequest>(c.req.raw);
    const clientOrigin = resolveRequestClientOrigin(c.req.raw, body.clientOrigin);
    const input = {
      message: body.message ?? "",
      images: body.images,
      documents: body.documents,
      ...(clientOrigin ? { clientOrigin } : {}),
    };
    const wantsStream =
      body.stream === true ||
      c.req.query("stream") === "true" ||
      c.req.header("Accept")?.includes("text/event-stream");

    if (wantsStream) {
      return streamMessage(session, input, () => {
        agent.scheduleSessionTitleGeneration(sessionId);
      });
    }

    const reply = await session.send(input);
    agent.scheduleSessionTitleGeneration(sessionId);
    return json<SendMessageResponse>({ reply });
  });
}
