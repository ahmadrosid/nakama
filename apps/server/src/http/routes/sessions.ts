import { writeFile } from "node:fs/promises";
import { createRoute, z } from "@hono/zod-openapi";
import type { AgentChatSession } from "@nakama/agent";
import type {
  BranchSessionRequest,
  BranchSessionResponse,
  ChatTurnUsage,
  CompactionResponse,
  CompactSessionRequest,
  CreateSessionRequest,
  CreateSessionResponse,
  ListSessionsResponse,
  SendMessageRequest,
  SendMessageResponse,
  SessionMessagesResponse,
  SessionStatusResponse,
  SessionSummary,
  UpdateSessionRequest,
} from "@nakama/core";
import {
  AGENT_CHANNELS,
  fetchRemoteImage,
  formatServerError,
  getChatWorkspaceDir,
  MAX_SESSION_SEARCH_LENGTH,
  NakamaApiError,
  readArtifactFile,
  reportError,
} from "@nakama/core";
import {
  createAttachmentSaver,
  deleteStoredAttachmentBytes,
  readStoredAttachmentBytes,
} from "../../services/attachment-service";
import {
  assertWorkspaceAccess,
  resolveWorkspaceFile,
  withWorkspaceSnapshot,
} from "../../services/chat-workspace-service";
import { resolveRequestClientOrigin } from "../../services/composio-callback-url";
import { sessionTurnRegistry } from "../../services/session-turn-registry";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
} from "../org-guards";
import {
  errorResponse,
  getRequestAuth,
  json,
  parseChannel,
  readJson,
  readOptionalJson,
  streamMessage,
  streamTurnSubscribe,
} from "../shared";
import type { HonoApp } from "../types";

const MAX_SESSION_PAGE_SIZE = 100;

export function registerSessionRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent } = options;
  const workspaceAccess = (c: Parameters<typeof getRequestAuth>[0]) => {
    const auth = getRequestAuth(c);
    return { ...auth, userId: auth.user.id };
  };
  app.get("/v1/workspaces", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const access = workspaceAccess(c);
    const workspaces = (
      (await options.databaseAdapter?.listWorkspaces(orgId)) ?? []
    ).filter((workspace) => {
      try {
        assertWorkspaceAccess(workspace, access);
        return true;
      } catch {
        return false;
      }
    });
    return json({ workspaces });
  });
  const projectSchema = z
    .object({ name: z.string().trim().min(1).max(120) })
    .strict();
  app.post("/v1/projects", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<{ name: string }>(c.req.raw, projectSchema);
    return json(
      {
        workspace: await agent.chatWorkspaces.create(
          orgId,
          "project",
          body.name,
          auth.user.id
        ),
      },
      201
    );
  });
  app.get("/v1/workspaces/:workspaceId", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    return json({
      workspace: await agent.chatWorkspaces.require(
        orgId,
        c.req.param("workspaceId"),
        workspaceAccess(c)
      ),
    });
  });
  app.patch("/v1/workspaces/:workspaceId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId"),
      workspaceAccess(c)
    );
    const { name } = await readJson<{ name: string }>(c.req.raw, projectSchema);
    await options.databaseAdapter?.upsertWorkspace({
      ...workspace,
      name,
      updatedAt: new Date().toISOString(),
    });
    return json({ workspace: { ...workspace, name } });
  });
  app.delete("/v1/workspaces/:workspaceId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId"),
      workspaceAccess(c),
      true
    );
    await agent.purgeWorkspace(workspace.id, orgId);
    return new Response(null, { status: 204 });
  });
  app.get("/v1/workspaces/:workspaceId/files", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId"),
      workspaceAccess(c)
    );
    return json({
      files: await agent.chatWorkspaces.files(
        workspace,
        c.req.query("sessionId")
      ),
    });
  });
  const uploadSchema = z
    .object({
      filename: z.string().min(1).max(255),
      mediaType: z.string().min(1).max(120),
      data: z.string().max(8_000_000),
      sessionId: z.string().optional(),
    })
    .strict();
  app.post("/v1/workspaces/:workspaceId/files", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId"),
      workspaceAccess(c)
    );
    const body = await readJson<z.infer<typeof uploadSchema>>(
      c.req.raw,
      uploadSchema
    );
    if (workspace.id.startsWith("recovered-")) {
      return errorResponse("Recovered files are read-only.", 400);
    }
    const db = options.databaseAdapter;
    if (!db) {
      return errorResponse("Storage unavailable.", 503);
    }
    const session = body.sessionId ? await db.getSession(body.sessionId) : null;
    if (body.sessionId && session?.workspaceId !== workspace.id) {
      return errorResponse("Session not found.", 404);
    }
    if (!session && workspace.kind !== "project") {
      return errorResponse("A chat session is required.", 400);
    }
    const root = getChatWorkspaceDir(orgId, workspace.id);
    const roots = session
      ? await agent.chatWorkspaces.roots(session)
      : { workspaceRoot: root, chatRoot: root };
    const bytes = Buffer.from(body.data, "base64");
    if (
      !body.data ||
      bytes.length > 5_000_000 ||
      bytes.toString("base64") !== body.data
    ) {
      return errorResponse("Invalid file data or file exceeds 5 MB.", 400);
    }
    const saved = await createAttachmentSaver(db, {
      ...roots,
      workspaceId: workspace.id,
      orgId,
      profileId: session?.profileId ?? "",
      sessionId: session?.id ?? null,
      channel: "web",
      purpose: session ? "input" : "reference",
    })({
      kind: body.mediaType.startsWith("image/") ? "image" : "document",
      filename: body.filename,
      mediaType: body.mediaType,
      bytes,
    });
    return json(saved, 201);
  });
  app.put("/v1/workspaces/:workspaceId/files/content", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId"),
      workspaceAccess(c)
    );
    if (workspace.id.startsWith("recovered-")) {
      throw new NakamaApiError("Recovered files are read-only.", 400);
    }
    const body = await readJson<{ content: string }>(
      c.req.raw,
      z.object({ content: z.string().max(5_000_000) }).strict()
    );
    const path = c.req.query("path");
    const file = (await agent.chatWorkspaces.files(workspace)).find(
      (entry) => entry.path === path
    );
    if (!file || file.purpose !== "output") {
      throw new NakamaApiError("Output file not found.", 404);
    }
    return withWorkspaceSnapshot(workspace.id, async () => {
      await writeFile(
        await resolveWorkspaceFile(
          getChatWorkspaceDir(orgId, workspace.id),
          file.path
        ),
        body.content,
        { mode: 0o600 }
      );
      return json({ path: file.path });
    });
  });
  app.delete("/v1/workspaces/:workspaceId/files/:fileId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId"),
      workspaceAccess(c)
    );
    if (workspace.id.startsWith("recovered-")) {
      throw new NakamaApiError("Recovered files are read-only.", 400);
    }
    const file = await options.databaseAdapter?.getAttachment(
      c.req.param("fileId")
    );
    if (!file || file.workspaceId !== workspace.id) {
      throw new NakamaApiError("File not found.", 404);
    }
    await withWorkspaceSnapshot(workspace.id, async () => {
      await agent.chatWorkspaces.removeFileShares(workspace.id, file.id);
      await deleteStoredAttachmentBytes(file);
      await options.databaseAdapter?.deleteAttachment(file.id);
    });
    return new Response(null, { status: 204 });
  });
  app.get("/v1/workspaces/:workspaceId/pins", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId"),
      workspaceAccess(c)
    );
    return json({
      fileIds:
        (await options.databaseAdapter?.listWorkspaceFilePins(
          orgId,
          getRequestAuth(c).user.id,
          workspace.id
        )) ?? [],
    });
  });
  app.put("/v1/workspaces/:workspaceId/pins", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId"),
      workspaceAccess(c)
    );
    const body = await readJson<{ fileId: string; pinned: boolean }>(
      c.req.raw,
      z.object({ fileId: z.string(), pinned: z.boolean() }).strict()
    );
    const file = await options.databaseAdapter?.getAttachment(body.fileId);
    if (!file || file.workspaceId !== workspace.id) {
      throw new NakamaApiError("File not found.", 404);
    }
    await options.databaseAdapter?.setWorkspaceFilePin(
      orgId,
      auth.user.id,
      workspace.id,
      file.id,
      body.pinned
    );
    return new Response(null, { status: 204 });
  });
  app.get("/v1/workspaces/:workspaceId/files/:fileId/content", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId"),
      workspaceAccess(c)
    );
    const file = await options.databaseAdapter?.getAttachment(
      c.req.param("fileId")
    );
    if (!file || file.workspaceId !== workspace.id) {
      return errorResponse("File not found.", 404);
    }
    const bytes = await readStoredAttachmentBytes(file);
    if (!bytes) {
      return errorResponse("File not found.", 404);
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mediaType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename ?? file.id)}`,
        "Cache-Control": "no-store",
      },
    });
  });
  app.get("/v1/workspaces/:workspaceId/files/content", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId"),
      workspaceAccess(c)
    );
    const path = c.req.query("path");
    if (!path) {
      return errorResponse("File path is required.", 400);
    }
    const file = await readArtifactFile({
      orgId,
      profileId: "",
      directory: getChatWorkspaceDir(orgId, workspace.id),
      filename: path,
      render: c.req.query("render") === "markdown" ? "markdown" : undefined,
    });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Content-Disposition": `${c.req.query("inline") === "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(path.split("/").at(-1) ?? "file")}`,
      },
    });
  });
  // createSession refuses Super Bot to non-admins. Every route that names an
  // existing session repeats the check, or holding the ID would be enough.
  const requireSessionAccess = async (
    c: Parameters<typeof requireActiveOrgIdFromContext>[0]
  ) => {
    const auth = getRequestAuth(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const sessionId = decodeURIComponent(c.req.param("sessionId") ?? "");
    await agent.assertSessionProfileAccess(sessionId, orgId, {
      ...auth,
      userId: auth.user.id,
    });
    return { orgId, sessionId };
  };
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const workspaceSchema = z
    .object({
      id: z.string(),
      orgId: z.string(),
      name: z.string(),
      kind: z.enum(["chat", "project"]),
      access: z.enum(["org", "owner", "admin"]),
      ownerUserId: z.string().nullable(),
      state: z.enum(["active", "deleting"]),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .openapi("ChatWorkspace");
  const workspaceFileSchema = z
    .object({
      id: z.string(),
      workspaceId: z.string(),
      sessionId: z.string().nullable(),
      filename: z.string(),
      mediaType: z.string(),
      path: z.string(),
      purpose: z.enum(["input", "output", "reference"]),
      sizeBytes: z.number(),
    })
    .openapi("ChatWorkspaceFile");
  const workspaceParams = z.object({ workspaceId: z.string() });
  const fileParams = workspaceParams.extend({ fileId: z.string() });
  const pathQuery = z.object({
    path: z.string(),
    inline: z.enum(["0", "1"]).optional(),
    render: z.enum(["markdown"]).optional(),
  });
  const jsonResponse = (schema: z.ZodType) => ({
    description: "Success",
    content: { "application/json": { schema } },
  });
  const workspaceResponse = z.object({ workspace: workspaceSchema });
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/workspaces",
      tags: ["Workspaces"],
      summary: "List accessible chat and project folders",
      responses: {
        200: jsonResponse(z.object({ workspaces: z.array(workspaceSchema) })),
      },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/projects",
      tags: ["Workspaces"],
      summary: "Create a project folder",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: projectSchema } },
        },
      },
      responses: { 201: jsonResponse(workspaceResponse) },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/workspaces/{workspaceId}",
      tags: ["Workspaces"],
      summary: "Get a folder",
      request: { params: workspaceParams },
      responses: { 200: jsonResponse(workspaceResponse) },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "patch",
      path: "/v1/workspaces/{workspaceId}",
      tags: ["Workspaces"],
      summary: "Rename a folder",
      request: {
        params: workspaceParams,
        body: {
          required: true,
          content: { "application/json": { schema: projectSchema } },
        },
      },
      responses: { 200: jsonResponse(workspaceResponse) },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      path: "/v1/workspaces/{workspaceId}",
      tags: ["Workspaces"],
      summary: "Delete a folder and its chats and files",
      request: { params: workspaceParams },
      responses: {
        204: { description: "Deleted" },
        409: jsonResponse(errorSchema),
      },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/workspaces/{workspaceId}/files",
      tags: ["Workspaces"],
      summary: "List folder files",
      request: {
        params: workspaceParams,
        query: z.object({ sessionId: z.string().optional() }),
      },
      responses: {
        200: jsonResponse(z.object({ files: z.array(workspaceFileSchema) })),
      },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/workspaces/{workspaceId}/files",
      tags: ["Workspaces"],
      summary: "Upload a reference or chat input (maximum 5 MB)",
      request: {
        params: workspaceParams,
        body: {
          required: true,
          content: { "application/json": { schema: uploadSchema } },
        },
      },
      responses: {
        201: jsonResponse(
          z.object({ attachmentId: z.string(), size: z.number() })
        ),
      },
    })
  );
  for (const path of [
    "/v1/workspaces/{workspaceId}/files/{fileId}/content",
    "/v1/workspaces/{workspaceId}/files/content",
  ]) {
    app.openAPIRegistry.registerPath(
      createRoute({
        method: "get",
        path,
        tags: ["Workspaces"],
        summary: "Read a folder file",
        request: path.includes("{fileId}")
          ? { params: fileParams }
          : { params: workspaceParams, query: pathQuery },
        responses: {
          200: {
            description: "File bytes",
            content: {
              "application/octet-stream": {
                schema: z.string().openapi({ format: "binary" }),
              },
            },
          },
        },
      })
    );
  }
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      path: "/v1/workspaces/{workspaceId}/files/content",
      tags: ["Workspaces"],
      summary: "Edit an output file",
      request: {
        params: workspaceParams,
        query: z.object({ path: z.string() }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ content: z.string().max(5_000_000) }).strict(),
            },
          },
        },
      },
      responses: {
        200: jsonResponse(z.object({ path: z.string() })),
        409: jsonResponse(errorSchema),
      },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      path: "/v1/workspaces/{workspaceId}/files/{fileId}",
      tags: ["Workspaces"],
      summary: "Delete a folder file and its shares",
      request: { params: fileParams },
      responses: {
        204: { description: "Deleted" },
        409: jsonResponse(errorSchema),
      },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/workspaces/{workspaceId}/pins",
      tags: ["Workspaces"],
      summary: "List your pinned files",
      request: { params: workspaceParams },
      responses: {
        200: jsonResponse(z.object({ fileIds: z.array(z.string()) })),
      },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      path: "/v1/workspaces/{workspaceId}/pins",
      tags: ["Workspaces"],
      summary: "Pin or unpin a folder file",
      request: {
        params: workspaceParams,
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({ fileId: z.string(), pinned: z.boolean() })
                .strict(),
            },
          },
        },
      },
      responses: { 204: { description: "Updated" } },
    })
  );
  const agentChannelSchema = z.enum(AGENT_CHANNELS).openapi("AgentChannel");
  const createSessionRequestSchema = z
    .object({
      workspaceId: z.string().trim().min(1).optional(),
      channel: agentChannelSchema,
      cognito: z.boolean().optional(),
      codingWorkspaceRoot: z.string().optional(),
      model: z.string().trim().min(1).optional(),
      profileId: z.string().optional(),
    })
    .strict()
    .openapi("CreateSessionRequest");
  const createSessionResponseSchema = z
    .object({ sessionId: z.string() })
    .openapi("CreateSessionResponse");
  const sessionSummarySchema = z
    .object({
      workspaceId: z.string().optional(),
      activeProfileId: z.string().nullable().optional(),
      active: z.boolean().optional(),
      channel: agentChannelSchema,
      createdAt: z.string().optional(),
      id: z.string(),
      messageCount: z.number().optional(),
      pinned: z.boolean().optional(),
      preview: z.string().nullable().optional(),
      profileId: z.string(),
      title: z.string().nullable().optional(),
      updatedAt: z.string().optional(),
    })
    .passthrough()
    .openapi("SessionSummary");
  const listSessionsResponseSchema = z
    .object({
      nextCursor: z.string().nullable().optional(),
      sessions: z.array(sessionSummarySchema),
      stale: z.boolean().optional(),
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
      workspaceId: z.string().optional(),
      activeProfileId: z.string().nullable().optional(),
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
    .object({
      profileId: z.string().min(1).optional(),
      model: z.string().trim().min(1).nullable().optional(),
      pinned: z.boolean().optional(),
      title: z.string().trim().min(1).max(200).optional(),
    })
    .refine(
      (body) =>
        body.profileId !== undefined ||
        body.model !== undefined ||
        body.pinned !== undefined ||
        body.title !== undefined,
      "At least one session field is required."
    )
    .openapi("UpdateSessionRequest");
  const sendMessageRequestSchema = z
    .object({
      attachmentIds: z.array(z.string()).max(20).optional(),
      clientOrigin: z.string().optional(),
      documents: z
        .array(
          z.object({
            data: z.string(),
            mediaType: z.string(),
            filename: z.string(),
          })
        )
        .optional(),
      images: z
        .array(z.object({ data: z.string(), mediaType: z.string() }))
        .optional(),
      message: z.string(),
      stream: z.boolean().optional(),
    })
    .openapi("SendMessageRequest");
  const contextUsageSchema = z
    .object({
      breakdown: z
        .object({
          conversation: z.number(),
          systemPrompt: z.number(),
          toolDefinitions: z.number(),
        })
        .optional(),
      bytesKeptOut: z.number().optional(),
      bytesProduced: z.number().optional(),
      contextWindow: z.number(),
      source: z.enum(["provider", "estimate"]),
      usableContextTokens: z.number(),
      usedTokens: z.number(),
    })
    .openapi("ChatContextUsage");
  const chatUsageSchema = z
    .object({
      cachedInputTokens: z.number().optional(),
      costUsd: z.number().optional(),
      estimated: z.boolean().optional(),
      inputTokens: z.number(),
      modelId: z.string().optional(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    })
    .openapi("ChatUsage");
  const turnUsageSchema = z
    .object({
      cachedInputTokens: z.number(),
      calls: z.array(chatUsageSchema),
      costUsd: z.number().optional(),
      estimated: z.boolean(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    })
    .openapi("ChatTurnUsage");
  const sendMessageResponseSchema = z
    .object({
      contextUsage: contextUsageSchema.optional(),
      reply: z.string(),
      usage: turnUsageSchema.optional(),
    })
    .openapi("SendMessageResponse", {
      example: {
        contextUsage: {
          breakdown: {
            conversation: 420,
            systemPrompt: 980,
            toolDefinitions: 310,
          },
          contextWindow: 128_000,
          source: "estimate",
          usableContextTokens: 120_000,
          usedTokens: 1710,
        },
        reply: "Hello! How can I help?",
        usage: {
          cachedInputTokens: 0,
          calls: [
            {
              inputTokens: 1290,
              modelId: "gemini-2.5-flash",
              outputTokens: 64,
              totalTokens: 1354,
            },
          ],
          estimated: false,
          inputTokens: 1290,
          outputTokens: 64,
          totalTokens: 1354,
        },
      },
    });
  const sessionIdParamSchema = z.object({
    sessionId: z.string().openapi({ param: { in: "path", name: "sessionId" } }),
  });
  const sessionListQuerySchema = z.object({
    workspaceId: z.string().optional(),
    channel: agentChannelSchema.optional(),
    channels: z.string().optional().openapi({
      description: "Comma-separated channels, listed as one merged list.",
    }),
    cursor: z.string().optional().openapi({
      description: "`nextCursor` from the previous page.",
    }),
    limit: z
      .string()
      .optional()
      .openapi({
        description: `Page size, 1 to ${MAX_SESSION_PAGE_SIZE}. Without it every session is returned.`,
      }),
    profileId: z.string().optional(),
    q: z
      .string()
      .optional()
      .openapi({
        description: `Keeps the sessions whose title or message text contains it, up to ${MAX_SESSION_SEARCH_LENGTH} characters.`,
      }),
  });
  const streamQuerySchema = z.object({
    stream: z.enum(["true", "false"]).optional(),
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getRemoteChatImage",
      path: "/v1/chat/images/proxy",
      request: { query: z.object({ url: z.string().url().max(8192) }) },
      responses: {
        200: {
          description: "Public raster image bytes (maximum 5 MiB)",
          content: {
            "image/*": { schema: z.string().openapi({ format: "binary" }) },
          },
        },
        400: { description: "Missing organization context or invalid URL" },
        401: { description: "Authentication required" },
        404: { description: "Organization not found or inaccessible" },
        502: { description: "Image unavailable or blocked" },
      },
      summary: "Proxy a public HTTPS image for chat",
      tags: ["Chat"],
    })
  );

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getChatImageAttachment",
      path: "/v1/attachments/{attachmentId}/content",
      request: { params: z.object({ attachmentId: z.string() }) },
      responses: {
        200: {
          description: "Image bytes",
          content: {
            "image/*": { schema: z.string().openapi({ format: "binary" }) },
          },
        },
        401: { description: "Authentication required" },
        403: { description: "Profile access denied" },
        404: { description: "Image not found" },
      },
      summary: "Read an image attached to chat",
      tags: ["Chat"],
    })
  );

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
      method: "get",
      operationId: "getSession",
      path: "/v1/sessions/{sessionId}",
      request: { params: sessionIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: sessionSummarySchema } },
          description: "Session",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get one chat session",
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
            "text/event-stream": {
              example:
                'data: {"type":"tool_start","toolCallId":"call_1","tool":"search_files","input":{"query":"pricing"}}\\n\\ndata: {"type":"tool_end","toolCallId":"call_1","tool":"search_files","result":{"matches":[]}}\\n\\ndata: {"type":"chunk","delta":"I could not find any pricing files."}\\n\\ndata: {"type":"done","reply":"I could not find any pricing files."}\\n\\n',
              schema: z.string(),
            },
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

  app.get("/v1/chat/images/proxy", async (c) => {
    requireActiveOrgIdFromContext(c);
    const url = c.req.query("url");
    c.header("Cache-Control", "private, no-store");
    if (!url || url.length > 8192) {
      return c.json({ error: "Invalid image URL." }, 400);
    }
    try {
      const image = await fetchRemoteImage(
        url,
        AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(10_000)])
      );
      return c.body(image.bytes, 200, {
        "Content-Disposition": "attachment",
        "Content-Type": image.contentType,
        "X-Content-Type-Options": "nosniff",
      });
    } catch {
      return c.json({ error: "Image unavailable." }, 502);
    }
  });

  app.get("/v1/attachments/:attachmentId/content", async (c) => {
    const attachment = await agent.readChatImageAttachment(
      requireActiveOrgIdFromContext(c),
      c.req.param("attachmentId"),
      workspaceAccess(c)
    );
    if (!attachment) {
      return errorResponse("Image not found", 404);
    }
    return new Response(attachment.bytes, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "attachment",
        "Content-Type": attachment.mediaType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

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
    if (
      body.codingWorkspaceRoot !== undefined &&
      (channel !== "cli" || auth.mode !== "local-token")
    ) {
      return errorResponse(
        "Coding workspace is only available to the local CLI.",
        400
      );
    }
    const sessionId = await agent.createSession(
      orgId,
      channel,
      body.profileId,
      auth.user.id,
      {
        workspaceId: body.workspaceId,
        cognito: body.cognito,
        codingWorkspaceRoot: body.codingWorkspaceRoot,
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
    const auth = getRequestAuth(c);
    const profileId = c.req.query("profileId")?.trim();
    const channelsParam = c.req.query("channels");
    const channels =
      channelsParam === undefined
        ? parseChannel(c.req.query("channel"))
        : channelsParam.split(",").map((channel) => parseChannel(channel));
    const limitParam = c.req.query("limit");
    const limit = limitParam === undefined ? undefined : Number(limitParam);
    const query = c.req.query("q")?.trim() || undefined;

    if (
      limit !== undefined &&
      !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_SESSION_PAGE_SIZE)
    ) {
      return errorResponse(
        `limit must be an integer from 1 to ${MAX_SESSION_PAGE_SIZE}.`,
        400
      );
    }
    if (query && query.length > MAX_SESSION_SEARCH_LENGTH) {
      return errorResponse(
        `q must be at most ${MAX_SESSION_SEARCH_LENGTH} characters.`,
        400
      );
    }

    return json<ListSessionsResponse>(
      await agent.listSessions(
        orgId,
        profileId,
        channels,
        { ...auth, userId: auth.user.id },
        c.req.query("workspaceId"),
        limit === undefined
          ? undefined
          : { cursor: c.req.query("cursor"), limit },
        query
      )
    );
  });

  app.get("/v1/sessions/:sessionId", async (c) => {
    const { orgId, sessionId } = await requireSessionAccess(c);
    const session = await agent.getSessionSummary(sessionId, orgId);

    if (!session) {
      return errorResponse("Session not found", 404);
    }

    return json<SessionSummary>(session);
  });

  app.delete("/v1/sessions/:sessionId", async (c) => {
    requireNotViewerFromContext(c);
    const { orgId, sessionId } = await requireSessionAccess(c);
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
    const { orgId, sessionId } = await requireSessionAccess(c);
    const parsedBody = updateSessionRequestSchema.safeParse(
      await readJson<unknown>(c.req.raw)
    );
    if (!parsedBody.success) {
      return errorResponse("Invalid session update.", 400);
    }
    const body: UpdateSessionRequest = parsedBody.data;
    if (body.profileId !== undefined) {
      await agent.changeSessionAgent(
        sessionId,
        orgId,
        body.profileId,
        workspaceAccess(c)
      );
    }
    if (body.model !== undefined) {
      const updated = await agent.updateSessionModel(
        sessionId,
        orgId,
        body.model
      );
      if (!updated) {
        return errorResponse("Session not found", 404);
      }
    }
    if (body.title !== undefined) {
      const updated = await agent.renameSession(sessionId, orgId, body.title);
      if (!updated) {
        return errorResponse("Session not found", 404);
      }
    }
    if (body.pinned !== undefined) {
      const updated = await agent.updateSessionPinned(
        sessionId,
        orgId,
        body.pinned
      );
      if (!updated) {
        return errorResponse("Session not found", 404);
      }
    }

    return new Response(null, { status: 204 });
  });

  app.post("/v1/sessions/:sessionId/compact", async (c) => {
    requireNotViewerFromContext(c);
    const { orgId, sessionId } = await requireSessionAccess(c);
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
    const { orgId, sessionId } = await requireSessionAccess(c);
    const result = await agent.getSessionMessages(sessionId, orgId);

    if (!result) {
      return errorResponse("Session not found", 404);
    }

    const todos = (await agent.getSessionTodos(sessionId, orgId)) ?? [];
    const questionnaire =
      (await agent.getSessionQuestionnaire(sessionId, orgId)) ?? null;
    return json<SessionMessagesResponse>({
      workspaceId: result.workspaceId,
      activeProfileId: result.activeProfileId,
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
    const { orgId, sessionId } = await requireSessionAccess(c);
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
    const { orgId, sessionId } = await requireSessionAccess(c);
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
    const { orgId, sessionId } = await requireSessionAccess(c);
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
    const { orgId, sessionId } = await requireSessionAccess(c);

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
    let attachmentRefs;
    try {
      const resolvedSession = await agent.resolveSession(sessionId, orgId);
      if (!resolvedSession) {
        sessionTurnRegistry.cancelTurn(sessionId);
        return errorResponse("Session not found", 404);
      }
      session = resolvedSession;
      body = await readJson<SendMessageRequest>(
        c.req.raw,
        sendMessageRequestSchema
      );
      attachmentRefs = body.attachmentIds?.length
        ? await agent.validateSessionAttachments(
            sessionId,
            orgId,
            body.attachmentIds
          )
        : [];
    } catch (error) {
      sessionTurnRegistry.cancelTurn(sessionId);
      throw error;
    }

    const clientOrigin = resolveRequestClientOrigin(
      c.req.raw,
      body.clientOrigin
    );
    const input = {
      attachmentRefs,
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
            void Promise.resolve(
              agent.schedulePostTurnSkillReview(sessionId)
            ).catch(() => undefined);
          }
        },
        c.req.raw.signal
      );
    }

    try {
      const reply = await session.send(input);
      const contextUsage = session.getContextUsage() ?? undefined;
      const usage = session.getTurnUsage() ?? undefined;
      sessionTurnRegistry.endTurn(sessionId, {
        reply,
        type: "done",
        ...(contextUsage ? { contextUsage } : {}),
        ...(usage ? { usage } : {}),
      });
      agent.scheduleSessionTitleGeneration(sessionId);
      void Promise.resolve(agent.schedulePostTurnSkillReview(sessionId)).catch(
        () => undefined
      );
      return json<SendMessageResponse>({
        reply,
        ...(contextUsage ? { contextUsage } : {}),
        ...(usage ? { usage } : {}),
      });
    } catch (error) {
      if (!(error instanceof NakamaApiError && error.status < 500)) {
        void reportError(error, { kind: "turn", source: "server" });
      }
      const message = formatServerError(error);
      // Same guard as the stream error branch: this read sits inside the catch,
      // so a throw would swallow the failure it is meant to report.
      let spent: ChatTurnUsage | undefined;
      try {
        spent = session.getTurnUsage() ?? undefined;
      } catch {
        spent = undefined;
      }
      sessionTurnRegistry.endTurn(sessionId, {
        error: message,
        type: "error",
        ...(spent ? { usage: spent } : {}),
      });
      return errorResponse(
        message,
        error instanceof NakamaApiError ? error.status : 500,
        spent ? { usage: spent } : undefined
      );
    }
  });
}
