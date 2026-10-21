import { createRoute, z } from "@hono/zod-openapi";
import { listGroupFiles, NakamaApiError, readGroupFile } from "@nakama/core";
import type {
  AgentGroup,
  AgentGroupSession,
  AgentGroupSessionDetail,
  AgentGroupThreadDetail,
  ListAgentGroupSessionsResponse,
  ListAgentGroupsResponse,
  ListRailPinsResponse,
} from "@nakama/core/agent-groups";
import type { Context } from "hono";
import {
  AgentGroupService,
  readGroupDocuments,
} from "../../services/agent-group-service";
import { listRailPins, setRailPin } from "../../services/agent-group-store";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgMemberFromContext,
} from "../org-guards";
import { json, readJson } from "../shared";
import type { HonoApp } from "../types";

const groupSchema = z.object({
  brief: z.string().trim().max(4000).default(""),
  memberIds: z.array(z.string().min(1)).min(2).max(12),
  name: z.string().trim().min(1).max(80),
});

const imageSchema = z.object({ data: z.string(), mediaType: z.string() });

const messageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
});

// A message may hold only documents, so its text can be empty.
const groupMessageSchema = z
  .object({
    content: z.string().trim().max(8000).default(""),
    documents: z
      .array(
        z.object({
          data: z.string(),
          filename: z.string(),
          mediaType: z.string(),
        })
      )
      .max(5)
      .default([]),
  })
  .refine((body) => body.content || body.documents.length > 0, {
    message: "Message must include text or a document.",
  });

const sessionChangesSchema = z
  .object({
    pinned: z.boolean().optional(),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .refine((changes) => changes.pinned !== undefined || changes.title, {
    message: "Nothing to change",
  });

const SESSION_PATH = "/v1/agent-groups/{groupId}/sessions/{sessionId}";

const THREAD_PATH = `${SESSION_PATH}/threads/{messageId}`;

// [method, path, summary, status, body]: documents the plain routes below in
// /openapi.json.
const DOCUMENTED_ROUTES: [
  "delete" | "get" | "patch" | "post" | "put",
  string,
  string,
  number,
  z.ZodType?,
][] = [
  ["get", "/v1/agent-groups", "List your agent groups", 200],
  ["post", "/v1/agent-groups", "Create an agent group", 201, groupSchema],
  ["get", "/v1/agent-groups/{groupId}", "Get an agent group", 200],
  ["put", "/v1/agent-groups/{groupId}", "Edit a group", 200, groupSchema],
  ["delete", "/v1/agent-groups/{groupId}", "Delete a group and its chats", 204],
  ["get", "/v1/agent-groups/{groupId}/avatar", "Get a group's photo", 200],
  [
    "put",
    "/v1/agent-groups/{groupId}/avatar",
    "Replace a group's photo",
    204,
    imageSchema,
  ],
  [
    "delete",
    "/v1/agent-groups/{groupId}/avatar",
    "Remove a group's photo",
    204,
  ],
  ["get", "/v1/agent-groups/{groupId}/files", "List a shared folder", 200],
  [
    "get",
    "/v1/agent-groups/{groupId}/files/content",
    "Download a file from a group's shared folder",
    200,
  ],
  ["get", "/v1/agent-groups/{groupId}/sessions", "List a group's chats", 200],
  [
    "post",
    "/v1/agent-groups/{groupId}/sessions",
    "Start a chat with its first message",
    201,
    groupMessageSchema,
  ],
  ["get", SESSION_PATH, "Get a chat, its messages and its run", 200],
  ["patch", SESSION_PATH, "Rename or pin a chat", 204, sessionChangesSchema],
  ["delete", SESSION_PATH, "Delete a chat", 204],
  [
    "post",
    `${SESSION_PATH}/messages`,
    "Send a message; mentioned agents reply in the background",
    204,
    groupMessageSchema,
  ],
  ["post", `${SESSION_PATH}/stop`, "Stop after the current reply", 204],
  ["get", THREAD_PATH, "Get a thread on an agent's message", 200],
  [
    "post",
    `${THREAD_PATH}/messages`,
    "Send a message in a thread; its agent replies in the background",
    204,
    messageSchema,
  ],
  ["post", `${THREAD_PATH}/stop`, "Stop a thread's reply", 204],
  [
    "get",
    "/v1/rail-pins",
    "List the agents and groups pinned in the rail",
    200,
  ],
  ["put", "/v1/rail-pins/{itemId}", "Pin an agent or group to the top", 204],
  ["delete", "/v1/rail-pins/{itemId}", "Unpin an agent or group", 204],
];

function documentRoutes(app: HonoApp): void {
  for (const [method, path, summary, status, body] of DOCUMENTED_ROUTES) {
    const names = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);

    app.openAPIRegistry.registerPath(
      createRoute({
        method,
        path,
        request: {
          ...(body && {
            body: { content: { "application/json": { schema: body } } },
          }),
          params: z.object(
            Object.fromEntries(names.map((name) => [name, z.string()]))
          ),
        },
        responses: { [status]: { description: summary } },
        summary,
        tags: ["Agent groups"],
      })
    );
  }
}

function logRunFailure(groupId: string) {
  return (error: Error) => {
    console.error("[agent-groups] reply run failed", { error, groupId });
  };
}

export function registerAgentGroupRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  if (!options.databaseAdapter) {
    return;
  }

  // Built once so the in-memory run state lives as long as the process.
  const service = new AgentGroupService(options.databaseAdapter, options.agent);
  documentRoutes(app);

  app.get("/v1/agent-groups", (c) => {
    const auth = requireOrgMemberFromContext(c);

    return json<ListAgentGroupsResponse>({
      groups: service.list(requireActiveOrgIdFromContext(c), auth.user.id),
    });
  });

  app.post("/v1/agent-groups", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson(c.req.raw, groupSchema);

    return json<AgentGroup>(
      await service.create(
        orgId,
        auth.user.id,
        body.name,
        body.memberIds,
        body.brief
      ),
      201
    );
  });

  app.get("/v1/agent-groups/:groupId", (c) => {
    const auth = requireOrgMemberFromContext(c);

    return json<AgentGroup>(
      service.get(
        requireActiveOrgIdFromContext(c),
        auth.user.id,
        c.req.param("groupId")
      )
    );
  });

  app.put("/v1/agent-groups/:groupId", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson(c.req.raw, groupSchema);

    return json<AgentGroup>(
      await service.update(
        orgId,
        auth.user.id,
        c.req.param("groupId"),
        body.name,
        body.memberIds,
        body.brief
      )
    );
  });

  app.delete("/v1/agent-groups/:groupId", (c) => {
    const auth = requireOrgMemberFromContext(c);
    service.delete(
      requireActiveOrgIdFromContext(c),
      auth.user.id,
      c.req.param("groupId")
    );

    return c.body(null, 204);
  });

  app.get("/v1/agent-groups/:groupId/avatar", (c) => {
    const auth = requireOrgMemberFromContext(c);

    const avatar = service.avatar(
      requireActiveOrgIdFromContext(c),
      auth.user.id,
      c.req.param("groupId")
    );

    return new Response(new Uint8Array(avatar.bytes), {
      headers: { "Content-Type": avatar.mediaType },
    });
  });

  app.put("/v1/agent-groups/:groupId/avatar", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const image = await readJson(c.req.raw, imageSchema);
    service.setAvatar(orgId, auth.user.id, c.req.param("groupId"), image);

    return c.body(null, 204);
  });

  app.delete("/v1/agent-groups/:groupId/avatar", (c) => {
    const auth = requireOrgMemberFromContext(c);
    service.removeAvatar(
      requireActiveOrgIdFromContext(c),
      auth.user.id,
      c.req.param("groupId")
    );

    return c.body(null, 204);
  });

  app.get("/v1/agent-groups/:groupId/files", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const group = service.get(orgId, auth.user.id, c.req.param("groupId"));

    return json(await listGroupFiles(orgId, group.id, c.req.query("folder")));
  });

  app.get("/v1/agent-groups/:groupId/files/content", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const group = service.get(orgId, auth.user.id, c.req.param("groupId"));
    const filename = c.req.query("path");

    if (!filename) {
      return json({ error: "path is required" }, 400);
    }

    const file = await readGroupFile(orgId, group.id, filename, {
      render: c.req.query("render") === "markdown" ? "markdown" : undefined,
    });

    const disposition = c.req.query("inline") === "1" ? "inline" : "attachment";
    const body = "markdown" in file ? file.markdown : Bun.file(file.filePath);

    return new Response(body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename.split("/").pop() ?? "file")}`,
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });

  app.get("/v1/agent-groups/:groupId/sessions", (c) => {
    const auth = requireOrgMemberFromContext(c);

    return json<ListAgentGroupSessionsResponse>({
      sessions: service.sessions(
        requireActiveOrgIdFromContext(c),
        auth.user.id,
        c.req.param("groupId")
      ),
    });
  });

  app.post("/v1/agent-groups/:groupId/sessions", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const groupId = c.req.param("groupId");

    const { content, documents } = await readJson(
      c.req.raw,
      groupMessageSchema
    );

    const { run, session } = service.start(
      orgId,
      auth.user.id,
      groupId,
      content,
      await readGroupDocuments(documents)
    );

    // The reply run outlives the request; the page polls the session for it.
    run.catch(logRunFailure(groupId));

    return json<AgentGroupSession>(session, 201);
  });

  app.get("/v1/agent-groups/:groupId/sessions/:sessionId", (c) => {
    const auth = requireOrgMemberFromContext(c);

    return json<AgentGroupSessionDetail>(
      service.session(
        requireActiveOrgIdFromContext(c),
        auth.user.id,
        c.req.param("groupId"),
        c.req.param("sessionId")
      )
    );
  });

  app.patch("/v1/agent-groups/:groupId/sessions/:sessionId", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const changes = await readJson(c.req.raw, sessionChangesSchema);
    service.updateSession(
      orgId,
      auth.user.id,
      c.req.param("groupId"),
      c.req.param("sessionId"),
      changes
    );

    return c.body(null, 204);
  });

  app.delete("/v1/agent-groups/:groupId/sessions/:sessionId", (c) => {
    const auth = requireOrgMemberFromContext(c);
    service.deleteSession(
      requireActiveOrgIdFromContext(c),
      auth.user.id,
      c.req.param("groupId"),
      c.req.param("sessionId")
    );

    return c.body(null, 204);
  });

  app.post(
    "/v1/agent-groups/:groupId/sessions/:sessionId/messages",
    async (c) => {
      const auth = requireOrgMemberFromContext(c);
      const orgId = requireActiveOrgIdFromContext(c);
      const groupId = c.req.param("groupId");

      const { content, documents } = await readJson(
        c.req.raw,
        groupMessageSchema
      );

      service
        .post(
          orgId,
          auth.user.id,
          groupId,
          c.req.param("sessionId"),
          content,
          await readGroupDocuments(documents)
        )
        .catch(logRunFailure(groupId));

      return c.body(null, 204);
    }
  );

  app.post("/v1/agent-groups/:groupId/sessions/:sessionId/stop", (c) => {
    const auth = requireOrgMemberFromContext(c);
    service.stop(
      requireActiveOrgIdFromContext(c),
      auth.user.id,
      c.req.param("groupId"),
      c.req.param("sessionId")
    );

    return c.body(null, 204);
  });

  const threadParams = (c: Context) => {
    const messageId = Number(c.req.param("messageId"));

    if (!Number.isSafeInteger(messageId)) {
      throw new NakamaApiError("Invalid message id", 400);
    }

    return {
      groupId: c.req.param("groupId") ?? "",
      messageId,
      orgId: requireActiveOrgIdFromContext(c),
      sessionId: c.req.param("sessionId") ?? "",
      userId: requireOrgMemberFromContext(c).user.id,
    };
  };

  app.get(
    "/v1/agent-groups/:groupId/sessions/:sessionId/threads/:messageId",
    (c) => {
      const t = threadParams(c);

      return json<AgentGroupThreadDetail>(
        service.thread(t.orgId, t.userId, t.groupId, t.sessionId, t.messageId)
      );
    }
  );

  app.post(
    "/v1/agent-groups/:groupId/sessions/:sessionId/threads/:messageId/messages",
    async (c) => {
      const t = threadParams(c);

      const { content, documents } = await readJson(
        c.req.raw,
        groupMessageSchema
      );

      service
        .postThread(
          t.orgId,
          t.userId,
          t.groupId,
          t.sessionId,
          t.messageId,
          content,
          await readGroupDocuments(documents)
        )
        .catch(logRunFailure(t.groupId));

      return c.body(null, 204);
    }
  );

  app.post(
    "/v1/agent-groups/:groupId/sessions/:sessionId/threads/:messageId/stop",
    (c) => {
      const t = threadParams(c);
      service.stopThread(
        t.orgId,
        t.userId,
        t.groupId,
        t.sessionId,
        t.messageId
      );

      return c.body(null, 204);
    }
  );

  // Rail pins cover agents and groups alike; an unknown id only reorders nothing.
  app.get("/v1/rail-pins", (c) => {
    const auth = requireOrgMemberFromContext(c);

    return json<ListRailPinsResponse>({
      itemIds: listRailPins(requireActiveOrgIdFromContext(c), auth.user.id),
    });
  });

  for (const method of ["put", "delete"] as const) {
    app[method]("/v1/rail-pins/:itemId", (c) => {
      const auth = requireOrgMemberFromContext(c);
      const itemId = c.req.param("itemId");

      if (itemId.length > 200) {
        throw new NakamaApiError("Invalid item id", 400);
      }

      setRailPin(
        requireActiveOrgIdFromContext(c),
        auth.user.id,
        itemId,
        method === "put"
      );

      return c.body(null, 204);
    });
  }
}
