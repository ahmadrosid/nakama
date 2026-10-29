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

interface GroupRoute<P extends string, S extends z.ZodType | undefined> {
  body?: S;
  method: "delete" | "get" | "patch" | "post" | "put";
  path: P;
  status: number;
  summary: string;
}

/**
 * Serves one route and documents it in /openapi.json from the same path and
 * body schema, so the docs cannot drift from what the handler accepts.
 */
function route<P extends string, S extends z.ZodType | undefined = undefined>(
  app: HonoApp,
  { body, method, path, status, summary }: GroupRoute<P, S>,
  handler: (
    c: Context<AppEnv>,
    request: {
      body: S extends z.ZodType ? z.output<S> : undefined;
      orgId: string;
      params: Record<PathParams<P>, string>;
      userId: string;
    }
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
      },
      responses: { [status]: { description: summary } },
      summary,
      tags: ["Agent groups"],
    })
  );

  app[method](path.replaceAll(/\{(\w+)\}/g, ":$1"), async (c) => {
    // Every group route is for org members; check that before the body.
    const userId = requireOrgMemberFromContext(c).user.id;
    const orgId = requireActiveOrgIdFromContext(c);

    const parsed = body ? await readJson(c.req.raw, body) : undefined;

    // SAFETY: `names` are the `{name}` parts of `path`, and Hono matched the
    // request on that same path, so each one is set.
    const params = Object.fromEntries(
      names.map((name) => [name, c.req.param(name) ?? ""])
    ) as Record<PathParams<P>, string>;

    return handler(c, {
      // SAFETY: `parsed` is `body`'s output when `body` is set, else undefined.
      body: parsed as S extends z.ZodType ? z.output<S> : undefined,
      orgId,
      params,
      userId,
    });
  });
}

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
    (c, { orgId, userId }) =>
      json<ListAgentGroupsResponse>({
        groups: service.list(orgId, userId),
      })
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
    async (c, { body, orgId, userId }) =>
      json<AgentGroup>(
        await service.create(
          orgId,
          userId,
          body.name,
          body.memberIds,
          body.brief
        ),
        201
      )
  );

  route(
    app,
    {
      method: "get",
      path: GROUP_PATH,
      status: 200,
      summary: "Get an agent group",
    },
    (c, { params, orgId, userId }) =>
      json<AgentGroup>(service.get(orgId, userId, params.groupId))
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
    async (c, { body, params, orgId, userId }) =>
      json<AgentGroup>(
        await service.update(
          orgId,
          userId,
          params.groupId,
          body.name,
          body.memberIds,
          body.brief
        )
      )
  );

  route(
    app,
    {
      method: "delete",
      path: GROUP_PATH,
      status: 204,
      summary: "Delete a group and its chats",
    },
    (c, { params, orgId, userId }) => {
      service.delete(orgId, userId, params.groupId);

      return c.body(null, 204);
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
    (c, { params, orgId, userId }) => {
      const avatar = service.avatar(orgId, userId, params.groupId);

      return new Response(new Uint8Array(avatar.bytes), {
        headers: { "Content-Type": avatar.mediaType },
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
    (c, { body, params, orgId, userId }) => {
      service.setAvatar(orgId, userId, params.groupId, body);

      return c.body(null, 204);
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
    (c, { params, orgId, userId }) => {
      service.removeAvatar(orgId, userId, params.groupId);

      return c.body(null, 204);
    }
  );

  route(
    app,
    {
      method: "get",
      path: `${GROUP_PATH}/files`,
      status: 200,
      summary: "List a shared folder",
    },
    async (c, { params, orgId, userId }) => {
      const group = service.get(orgId, userId, params.groupId);

      return json(await listGroupFiles(orgId, group.id, c.req.query("folder")));
    }
  );

  route(
    app,
    {
      method: "get",
      path: `${GROUP_PATH}/files/content`,
      status: 200,
      summary: "Download a file from a group's shared folder",
    },
    async (c, { params, orgId, userId }) => {
      const group = service.get(orgId, userId, params.groupId);
      const filename = c.req.query("path");

      if (!filename) {
        return json({ error: "path is required" }, 400);
      }

      const file = await readGroupFile(orgId, group.id, filename, {
        render: c.req.query("render") === "markdown" ? "markdown" : undefined,
      });

      const disposition =
        c.req.query("inline") === "1" ? "inline" : "attachment";

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
    (c, { params, orgId, userId }) => {
      const group = service.get(orgId, userId, params.groupId);

      return json<AgentGroupMemory>({
        content: workspaceOfGroup(orgId, group.id).memory.read(),
        limit: GROUP_MEMORY_CHARS,
      });
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
    (c, { body, params, orgId, userId }) => {
      const group = service.get(orgId, userId, params.groupId);
      const { memory } = workspaceOfGroup(orgId, group.id);

      return json<AgentGroupMemory>({
        content: memory.replace(body.content, body.base),
        limit: GROUP_MEMORY_CHARS,
      });
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
    (c, { params, orgId, userId }) =>
      json<ListAgentGroupSessionsResponse>({
        sessions: service.sessions(orgId, userId, params.groupId),
      })
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
    async (c, { body, params, orgId, userId }) => {
      const { run, session } = service.start(
        orgId,
        userId,
        params.groupId,
        body.content,
        await readGroupDocuments(body.documents)
      );

      // The reply run outlives the request; the page polls the session for it.
      run.catch(logRunFailure(params.groupId));

      return json<AgentGroupSession>(session, 201);
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
    (c, { params, orgId, userId }) =>
      json<AgentGroupSessionDetail>(
        service.session(orgId, userId, params.groupId, params.sessionId)
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
    (c, { body, params, orgId, userId }) => {
      service.updateSession(
        orgId,
        userId,
        params.groupId,
        params.sessionId,
        body
      );

      return c.body(null, 204);
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
    (c, { params, orgId, userId }) => {
      service.deleteSession(orgId, userId, params.groupId, params.sessionId);

      return c.body(null, 204);
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
    async (c, { body, params, orgId, userId }) => {
      service
        .post(
          orgId,
          userId,
          params.groupId,
          params.sessionId,
          body.content,
          await readGroupDocuments(body.documents)
        )
        .catch(logRunFailure(params.groupId));

      return c.body(null, 204);
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
    (c, { params, orgId, userId }) => {
      service.stop(orgId, userId, params.groupId, params.sessionId);

      return c.body(null, 204);
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
    (c, { params, orgId, userId }) =>
      json<AgentGroupThreadDetail>(
        service.thread(
          orgId,
          userId,
          params.groupId,
          params.sessionId,
          messageIdOf(params.messageId)
        )
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
    async (c, { body, params, orgId, userId }) => {
      const messageId = messageIdOf(params.messageId);

      service
        .postThread(
          orgId,
          userId,
          params.groupId,
          params.sessionId,
          messageId,
          body.content,
          await readGroupDocuments(body.documents)
        )
        .catch(logRunFailure(params.groupId));

      return c.body(null, 204);
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
    (c, { params, orgId, userId }) => {
      service.stopThread(
        orgId,
        userId,
        params.groupId,
        params.sessionId,
        messageIdOf(params.messageId)
      );

      return c.body(null, 204);
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
    (c, { orgId, userId }) =>
      json<ListRailPinsResponse>({
        itemIds: listRailPins(orgId, userId),
      })
  );

  for (const [method, summary] of [
    ["put", "Pin an agent or group to the top"],
    ["delete", "Unpin an agent or group"],
  ] as const) {
    route(
      app,
      { method, path: "/v1/rail-pins/{itemId}", status: 204, summary },
      (c, { params, orgId, userId }) => {
        if (params.itemId.length > 200) {
          throw new NakamaApiError("Invalid item id", 400);
        }

        setRailPin(orgId, userId, params.itemId, method === "put");

        return c.body(null, 204);
      }
    );
  }
}
