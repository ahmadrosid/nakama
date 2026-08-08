import { createRoute, z } from "@hono/zod-openapi";
import type {
  AssignSkillRequest,
  CreateSkillRequest,
  ListSkillsResponse,
  PatchSkillRequest,
  ProfileResponse,
  SkillResponse,
  SyncSkillsResponse,
} from "@nakama/core";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerSkillRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent } = options;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const skillIdParam = z.object({
    skillId: z.string().openapi({ param: { in: "path", name: "skillId" } }),
  });
  const profileIdParam = z.object({
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
  });
  const profileSkillParams = z.object({
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
    skillId: z.string().openapi({ param: { in: "path", name: "skillId" } }),
  });
  const listSkillsSchema = z
    .object({})
    .passthrough()
    .openapi("ListSkillsResponse");
  const skillSchema = z.object({}).passthrough().openapi("SkillResponse");
  const syncSkillsSchema = z
    .object({})
    .passthrough()
    .openapi("SyncSkillsResponse");
  const createSkillSchema = z
    .object({})
    .passthrough()
    .openapi("CreateSkillRequest");
  const patchSkillSchema = z
    .object({})
    .passthrough()
    .openapi("PatchSkillRequest");
  const assignSkillSchema = z
    .object({})
    .passthrough()
    .openapi("AssignSkillRequest");
  const profileSchema = z.object({}).passthrough().openapi("ProfileResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listSkills",
      path: "/v1/skills",
      responses: {
        200: {
          content: { "application/json": { schema: listSkillsSchema } },
          description: "Skill list",
        },
      },
      summary: "List discovered skills",
      tags: ["Skills"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createSkill",
      path: "/v1/skills",
      request: {
        body: {
          content: { "application/json": { schema: createSkillSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: skillSchema } },
          description: "Skill detail",
        },
      },
      summary: "Create a skill",
      tags: ["Skills"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "syncSkills",
      path: "/v1/skills/sync",
      responses: {
        200: {
          content: { "application/json": { schema: syncSkillsSchema } },
          description: "Skills synced",
        },
      },
      summary: "Sync skills from disk into the database",
      tags: ["Skills"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getSkill",
      path: "/v1/skills/{skillId}",
      request: { params: skillIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: skillSchema } },
          description: "Skill detail",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get a skill",
      tags: ["Skills"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "patch",
      operationId: "patchSkill",
      path: "/v1/skills/{skillId}",
      request: {
        body: {
          content: { "application/json": { schema: patchSkillSchema } },
          required: true,
        },
        params: skillIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: skillSchema } },
          description: "Skill detail",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Update a skill",
      tags: ["Skills"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteSkill",
      path: "/v1/skills/{skillId}",
      request: { params: skillIdParam },
      responses: { 204: { description: "Skill deleted" } },
      summary: "Delete a skill",
      tags: ["Skills"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "assignSkillToProfile",
      path: "/v1/profiles/{profileId}/skills",
      request: {
        body: {
          content: { "application/json": { schema: assignSkillSchema } },
          required: true,
        },
        params: profileIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: profileSchema } },
          description: "Skill assigned",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Assign a skill to a profile",
      tags: ["Profiles", "Skills"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "unassignSkillFromProfile",
      path: "/v1/profiles/{profileId}/skills/{skillId}",
      request: { params: profileSkillParams },
      responses: {
        200: {
          content: { "application/json": { schema: profileSchema } },
          description: "Skill unassigned",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Unassign a skill from a profile",
      tags: ["Profiles", "Skills"],
    })
  );

  app.get("/v1/skills", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<ListSkillsResponse>(await agent.listSkills());
  });

  app.post("/v1/skills", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<CreateSkillRequest>(c.req.raw);
    return json<SkillResponse>(await agent.createSkill(orgId, body));
  });

  app.post("/v1/skills/sync", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<SyncSkillsResponse>(await agent.syncSkills());
  });

  app.get("/v1/skills/:skillId", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<SkillResponse>(
      await agent.getSkill(decodeURIComponent(c.req.param("skillId")))
    );
  });

  app.patch("/v1/skills/:skillId", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<PatchSkillRequest>(c.req.raw);
    const profileId = c.req.query("profileId")?.trim() || undefined;
    return json<SkillResponse>(
      await agent.patchSkill(
        orgId,
        decodeURIComponent(c.req.param("skillId")),
        body,
        profileId ? { profileId } : undefined
      )
    );
  });

  app.delete("/v1/skills/:skillId", async (c) => {
    requirePlatformAdminFromContext(c);
    await agent.deleteSkill(decodeURIComponent(c.req.param("skillId")));
    return new Response(null, { status: 204 });
  });

  app.post("/v1/profiles/:profileId/skills", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<AssignSkillRequest>(c.req.raw);
    return json<ProfileResponse>(
      await agent.assignSkill(
        orgId,
        decodeURIComponent(c.req.param("profileId")),
        body
      )
    );
  });

  app.delete("/v1/profiles/:profileId/skills/:skillId", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    return json<ProfileResponse>(
      await agent.unassignSkill(
        orgId,
        decodeURIComponent(c.req.param("profileId")),
        decodeURIComponent(c.req.param("skillId"))
      )
    );
  });
}
