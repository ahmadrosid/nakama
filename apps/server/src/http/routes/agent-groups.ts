import { createRoute, z } from "@hono/zod-openapi";
import { listGroupFiles, NakamaApiError, readGroupFile } from "@nakama/core";
import {
  type AgentGroup,
  type AgentGroupMemory,
  type AgentGroupSession,
  type AgentGroupSessionDetail,
  type AgentGroupThreadDetail,
  agentGroupInputSchema,
  type ListAgentGroupSessionsResponse,
  type ListAgentGroupsResponse,
  type ListRailPinsResponse,
} from "@nakama/core/agent-groups";
import type { Context } from "hono";
import { listRailPins, setRailPin } from "../../services/agent-group-store";
import { readGroupDocuments } from "../../services/agent-group-turn";
import {
  GROUP_MEMORY_CHARS,
  workspaceOfGroup,
} from "../../services/agent-group-workspace";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgMemberFromContext,
} from "../org-guards";
import { json, readJson } from "../shared";
import type { AppEnv, HonoApp } from "../types";

const imageSchema = z.object({ data: z.string(), mediaType: z.string() });

// `base` is the memory the editor opened, so a save cannot drop a newer fact.
const memorySchema = z.object({
  base: z.string(),
  content: z.string().max(65_536),
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
    message: "Message must include text or an attachment.",
  });

const sessionChangesSchema = z
  .object({
    pinned: z.boolean().optional(),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .refine((changes) => changes.pinned !== undefined || changes.title, {
    message: "Nothing to change",
  });

const GROUP_PATH = "/v1/agent-groups/{groupId}";

const SESSION_PATH = `${GROUP_PATH}/sessions/{sessionId}` as const;

const THREAD_PATH = `${SESSION_PATH}/threads/{messageId}` as const;

type PathParams<P extends string> =
  P extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PathParams<Rest>
    : never;

type RouteStatus = 200 | 201 | 204;

interface GroupRoute<
  P extends string,
  S extends z.ZodType | undefined,
  Q extends z.ZodObject | undefined,
> {
  body?: S;
  method: "delete" | "get" | "patch" | "post" | "put";
  path: P;
  query?: Q;
  status: RouteStatus;
  summary: string;
}

interface GroupRequest<
  P extends string,
  S extends z.ZodType | undefined,
  Q extends z.ZodObject | undefined,
> {
  orgId: string;
  params: Record<PathParams<P>, string>;
  /** Parses the body; handlers call it after their own 404 and id checks. */
  readBody: S extends z.ZodType ? () => Promise<z.output<S>> : undefined;
  readQuery: Q extends z.ZodObject ? () => z.output<Q> : undefined;
  /** The documented success status; send this one. */
  status: RouteStatus;
  userId: string;
}

/**
 * Serves one route and documents it in /openapi.json from the same path,
 * query, body schema and status, so the docs cannot drift from the handler.
 */
function route<
  P extends string,
  S extends z.ZodType | undefined = undefined,
  Q extends z.ZodObject | undefined = undefined,
>(
  app: HonoApp,
  { body, method, path, query, status, summary }: GroupRoute<P, S, Q>,
  handler: (
    c: Context<AppEnv>,
    request: GroupRequest<P, S, Q>
  ) => Response | Promise<Response>
): void {
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
        ...(query && { query }),
      },
      responses: { [status]: { description: summary } },
      summary,
      tags: ["Agent groups"],
    })
  );

  app[method](path.replaceAll(/\{(\w+)\}/g, ":$1"), (c) => {
    // Every group route is for org members; check that before anything else.
    const userId = requireOrgMemberFromContext(c).user.id;
    const orgId = requireActiveOrgIdFromContext(c);

    // SAFETY: `names` are the `{name}` parts of `path`, and Hono matched the
    // request on that same path, so each one is set.
    const params = Object.fromEntries(
      names.map((name) => [name, c.req.param(name) ?? ""])
    ) as Record<PathParams<P>, string>;

    const readBody = body && (() => readJson(c.req.raw, body));

    const readQuery =
      query &&
      (() => {
        const parsed = query.safeParse(c.req.query());

        if (!parsed.success) {
          throw new NakamaApiError(
            parsed.error.issues[0]?.message ?? "Invalid query.",
            400
          );
        }

        return parsed.data;
      });

    return handler(c, {
      orgId,
      params,
      // SAFETY: `readBody` is set exactly when `body` is set.
      readBody: readBody as GroupRequest<P, S, Q>["readBody"],
      // SAFETY: `readQuery` is set exactly when `query` is set.
      readQuery: readQuery as GroupRequest<P, S, Q>["readQuery"],
      status,
      userId,
    });
  });
}

const filesQuerySchema = z.object({ folder: z.string().optional() });

const fileContentQuerySchema = z.object({
  inline: z.string().optional(),
  path: z.string({ error: "path is required" }).min(1, "path is required"),
  render: z.string().optional(),
});

function logRunFailure(groupId: string) {
  return (error: Error) => {
    console.error("[agent-groups] reply run failed", { error, groupId });
  };
}

function messageIdOf(raw: string): number {
  const messageId = Number(raw);

  if (!Number.isSafeInteger(messageId)) {
    throw new NakamaApiError("Invalid message id", 400);
  }

  return messageId;
}

export function registerAgentGroupRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  if (!options.databaseAdapter) {
    return;
  }

  const service = options.agent.groups;

  route(
    app,
    {
      method: "get",
      path: "/v1/agent-groups",
      status: 200,
      summary: "List your agent groups",
    },
    (_c, { orgId, status, userId }) =>
      json<ListAgentGroupsResponse>(
        { groups: service.list(orgId, userId) },
        status
      )
  );

  route(
    app,
    {
      body: agentGroupInputSchema,
      method: "post",
      path: "/v1/agent-groups",
      status: 201,
      summary: "Create an agent group",
    },
    async (_c, { orgId, readBody, status, userId }) => {
      const body = await readBody();

      return json<AgentGroup>(
        await service.create(
          orgId,
          userId,
          body.name,
          body.memberIds,
          body.brief
        ),
        status
      );
    }
  );

  route(
    app,
    {
      method: "get",
      path: GROUP_PATH,
      status: 200,
      summary: "Get an agent group",
    },
    (_c, { params, orgId, status, userId }) =>
      json<AgentGroup>(service.get(orgId, userId, params.groupId), status)
  );

  route(
    app,
    {
      body: agentGroupInputSchema,
      method: "put",
      path: GROUP_PATH,
      status: 200,
      summary: "Edit a group",
    },
    async (_c, { params, orgId, readBody, status, userId }) => {
      const body = await readBody();

      return json<AgentGroup>(
        await service.update(
          orgId,
          userId,
          params.groupId,
          body.name,
          body.memberIds,
          body.brief
        ),
        status
      );
    }
  );

  route(
    app,
    {
      method: "delete",
      path: GROUP_PATH,
      status: 204,
      summary: "Delete a group and its chats",
    },
    (c, { params, orgId, status, userId }) => {
      service.delete(orgId, userId, params.groupId);

      return c.body(null, status);
    }
  );

  route(
    app,
    {
      method: "get",
      path: `${GROUP_PATH}/avatar`,
      status: 200,
      summary: "Get a group's photo",
    },
    (_c, { params, orgId, status, userId }) => {
      const avatar = service.avatar(orgId, userId, params.groupId);

      return new Response(new Uint8Array(avatar.bytes), {
        headers: { "Content-Type": avatar.mediaType },
        status,
      });
    }
  );

  route(
    app,
    {
      body: imageSchema,
      method: "put",
      path: `${GROUP_PATH}/avatar`,
      status: 204,
      summary: "Replace a group's photo",
    },
    async (c, { params, orgId, readBody, status, userId }) => {
      service.setAvatar(orgId, userId, params.groupId, await readBody());

      return c.body(null, status);
    }
  );

  route(
    app,
    {
      method: "delete",
      path: `${GROUP_PATH}/avatar`,
      status: 204,
      summary: "Remove a group's photo",
    },
    (c, { params, orgId, status, userId }) => {
      service.removeAvatar(orgId, userId, params.groupId);

      return c.body(null, status);
    }
  );

  route(
    app,
    {
      method: "get",
      path: `${GROUP_PATH}/files`,
      query: filesQuerySchema,
      status: 200,
      summary: "List a shared folder",
    },
    async (_c, { params, orgId, readQuery, status, userId }) => {
      const group = service.get(orgId, userId, params.groupId);
      const { folder } = readQuery();

      return json(await listGroupFiles(orgId, group.id, folder), status);
    }
  );

  route(
    app,
    {
      method: "get",
      path: `${GROUP_PATH}/files/content`,
      query: fileContentQuerySchema,
      status: 200,
      summary: "Download a file from a group's shared folder",
    },
    async (_c, { params, orgId, readQuery, status, userId }) => {
      const group = service.get(orgId, userId, params.groupId);
      const query = readQuery();

      const file = await readGroupFile(orgId, group.id, query.path, {
        render: query.render === "markdown" ? "markdown" : undefined,
      });

      const disposition = query.inline === "1" ? "inline" : "attachment";
      const body = "markdown" in file ? file.markdown : Bun.file(file.filePath);

      return new Response(body, {
        headers: {
          "Content-Type": file.contentType,
          "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(query.path.split("/").pop() ?? "file")}`,
          "Content-Security-Policy": "sandbox",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
        status,
      });
    }
  );

  route(
    app,
    {
      method: "get",
      path: `${GROUP_PATH}/memory`,
      status: 200,
      summary: "Read a group's memory",
    },
    (_c, { params, orgId, status, userId }) => {
      const group = service.get(orgId, userId, params.groupId);

      return json<AgentGroupMemory>(
        {
          content: workspaceOfGroup(orgId, group.id).memory.read(),
          limit: GROUP_MEMORY_CHARS,
        },
        status
      );
    }
  );

  route(
    app,
    {
      body: memorySchema,
      method: "put",
      path: `${GROUP_PATH}/memory`,
      status: 200,
      summary: "Replace a group's memory",
    },
    async (_c, { params, orgId, readBody, status, userId }) => {
      // An unknown group is a 404 even when the body is bad.
      const group = service.get(orgId, userId, params.groupId);
      const { base, content } = await readBody();
      const { memory } = workspaceOfGroup(orgId, group.id);

      return json<AgentGroupMemory>(
        { content: memory.replace(content, base), limit: GROUP_MEMORY_CHARS },
        status
      );
    }
  );

  route(
    app,
    {
      method: "get",
      path: `${GROUP_PATH}/sessions`,
      status: 200,
      summary: "List a group's chats",
    },
    (_c, { params, orgId, status, userId }) =>
      json<ListAgentGroupSessionsResponse>(
        { sessions: service.sessions(orgId, userId, params.groupId) },
        status
      )
  );

  route(
    app,
    {
      body: groupMessageSchema,
      method: "post",
      path: `${GROUP_PATH}/sessions`,
      status: 201,
      summary: "Start a chat with its first message",
    },
    async (_c, { params, orgId, readBody, status, userId }) => {
      const { content, documents } = await readBody();

      const { run, session } = service.start(
        orgId,
        userId,
        params.groupId,
        content,
        await readGroupDocuments(documents)
      );

      // The reply run outlives the request; the page polls the session for it.
      run.catch(logRunFailure(params.groupId));

      return json<AgentGroupSession>(session, status);
    }
  );

  route(
    app,
    {
      method: "get",
      path: SESSION_PATH,
      status: 200,
      summary: "Get a chat, its messages and its run",
    },
    (_c, { params, orgId, status, userId }) =>
      json<AgentGroupSessionDetail>(
        service.session(orgId, userId, params.groupId, params.sessionId),
        status
      )
  );

  route(
    app,
    {
      body: sessionChangesSchema,
      method: "patch",
      path: SESSION_PATH,
      status: 204,
      summary: "Rename or pin a chat",
    },
    async (c, { params, orgId, readBody, status, userId }) => {
      service.updateSession(
        orgId,
        userId,
        params.groupId,
        params.sessionId,
        await readBody()
      );

      return c.body(null, status);
    }
  );

  route(
    app,
    {
      method: "delete",
      path: SESSION_PATH,
      status: 204,
      summary: "Delete a chat",
    },
    (c, { params, orgId, status, userId }) => {
      service.deleteSession(orgId, userId, params.groupId, params.sessionId);

      return c.body(null, status);
    }
  );

  route(
    app,
    {
      body: groupMessageSchema,
      method: "post",
      path: `${SESSION_PATH}/messages`,
      status: 204,
      summary: "Send a message; mentioned agents reply in the background",
    },
    async (c, { params, orgId, readBody, status, userId }) => {
      const { content, documents } = await readBody();

      service
        .post(
          orgId,
          userId,
          params.groupId,
          params.sessionId,
          content,
          await readGroupDocuments(documents)
        )
        .catch(logRunFailure(params.groupId));

      return c.body(null, status);
    }
  );

  route(
    app,
    {
      method: "post",
      path: `${SESSION_PATH}/stop`,
      status: 204,
      summary: "Stop after the current reply",
    },
    (c, { params, orgId, status, userId }) => {
      service.stop(orgId, userId, params.groupId, params.sessionId);

      return c.body(null, status);
    }
  );

  route(
    app,
    {
      method: "get",
      path: THREAD_PATH,
      status: 200,
      summary: "Get a thread on an agent's message",
    },
    (_c, { params, orgId, status, userId }) =>
      json<AgentGroupThreadDetail>(
        service.thread(
          orgId,
          userId,
          params.groupId,
          params.sessionId,
          messageIdOf(params.messageId)
        ),
        status
      )
  );

  route(
    app,
    {
      body: groupMessageSchema,
      method: "post",
      path: `${THREAD_PATH}/messages`,
      status: 204,
      summary:
        "Send a message in a thread; its agent replies in the background",
    },
    async (c, { params, orgId, readBody, status, userId }) => {
      // A bad message id is reported before a bad body.
      const messageId = messageIdOf(params.messageId);
      const { content, documents } = await readBody();

      service
        .postThread(
          orgId,
          userId,
          params.groupId,
          params.sessionId,
          messageId,
          content,
          await readGroupDocuments(documents)
        )
        .catch(logRunFailure(params.groupId));

      return c.body(null, status);
    }
  );

  route(
    app,
    {
      method: "post",
      path: `${THREAD_PATH}/stop`,
      status: 204,
      summary: "Stop a thread's reply",
    },
    (c, { params, orgId, status, userId }) => {
      service.stopThread(
        orgId,
        userId,
        params.groupId,
        params.sessionId,
        messageIdOf(params.messageId)
      );

      return c.body(null, status);
    }
  );

  // Rail pins cover agents and groups alike; an unknown id only reorders nothing.
  route(
    app,
    {
      method: "get",
      path: "/v1/rail-pins",
      status: 200,
      summary: "List the agents and groups pinned in the rail",
    },
    (_c, { orgId, status, userId }) =>
      json<ListRailPinsResponse>(
        { itemIds: listRailPins(orgId, userId) },
        status
      )
  );

  for (const [method, summary] of [
    ["put", "Pin an agent or group to the top"],
    ["delete", "Unpin an agent or group"],
  ] as const) {
    route(
      app,
      { method, path: "/v1/rail-pins/{itemId}", status: 204, summary },
      (c, { params, orgId, status, userId }) => {
        if (params.itemId.length > 200) {
          throw new NakamaApiError("Invalid item id", 400);
        }

        setRailPin(orgId, userId, params.itemId, method === "put");

        return c.body(null, status);
      }
    );
  }
}
