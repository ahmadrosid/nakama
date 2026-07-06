import { createRoute, z } from "@hono/zod-openapi";
import type {
  AssignSkillRequest,
  CreateSkillRequest,
  ListSkillsResponse,
  ProfileResponse,
  SkillResponse,
  SyncSkillsResponse,
} from "@nakama/core";
import { json, readJson } from "../shared";
import { requirePlatformAdminFromContext, requireActiveOrgIdFromContext } from "../org-guards";
import type { ServerOptions } from "../context";
import type { HonoApp } from "../types";

export function registerSkillRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const skillIdParam = z.object({
    skillId: z.string().openapi({ param: { name: "skillId", in: "path" } }),
  });
  const profileIdParam = z.object({
    profileId: z.string().openapi({ param: { name: "profileId", in: "path" } }),
  });
  const profileSkillParams = z.object({
    profileId: z.string().openapi({ param: { name: "profileId", in: "path" } }),
    skillId: z.string().openapi({ param: { name: "skillId", in: "path" } }),
  });
  const listSkillsSchema = z.object({}).passthrough().openapi("ListSkillsResponse");
  const skillSchema = z.object({}).passthrough().openapi("SkillResponse");
  const syncSkillsSchema = z.object({}).passthrough().openapi("SyncSkillsResponse");
  const createSkillSchema = z.object({}).passthrough().openapi("CreateSkillRequest");
  const assignSkillSchema = z.object({}).passthrough().openapi("AssignSkillRequest");
  const profileSchema = z.object({}).passthrough().openapi("ProfileResponse");

  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/skills",
    tags: ["Skills"],
    summary: "List discovered skills",
    operationId: "listSkills",
    responses: { 200: { description: "Skill list", content: { "application/json": { schema: listSkillsSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/skills",
    tags: ["Skills"],
    summary: "Create a skill",
    operationId: "createSkill",
    request: { body: { required: true, content: { "application/json": { schema: createSkillSchema } } } },
    responses: { 200: { description: "Skill detail", content: { "application/json": { schema: skillSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/skills/sync",
    tags: ["Skills"],
    summary: "Sync skills from disk into the database",
    operationId: "syncSkills",
    responses: { 200: { description: "Skills synced", content: { "application/json": { schema: syncSkillsSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/skills/{skillId}",
    tags: ["Skills"],
    summary: "Get a skill",
    operationId: "getSkill",
    request: { params: skillIdParam },
    responses: {
      200: { description: "Skill detail", content: { "application/json": { schema: skillSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/skills/{skillId}",
    tags: ["Skills"],
    summary: "Delete a skill",
    operationId: "deleteSkill",
    request: { params: skillIdParam },
    responses: { 204: { description: "Skill deleted" } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/profiles/{profileId}/skills",
    tags: ["Profiles", "Skills"],
    summary: "Assign a skill to a profile",
    operationId: "assignSkillToProfile",
    request: { params: profileIdParam, body: { required: true, content: { "application/json": { schema: assignSkillSchema } } } },
    responses: {
      200: { description: "Skill assigned", content: { "application/json": { schema: profileSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/profiles/{profileId}/skills/{skillId}",
    tags: ["Profiles", "Skills"],
    summary: "Unassign a skill from a profile",
    operationId: "unassignSkillFromProfile",
    request: { params: profileSkillParams },
    responses: {
      200: { description: "Skill unassigned", content: { "application/json": { schema: profileSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));

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
    return json<SkillResponse>(await agent.getSkill(decodeURIComponent(c.req.param("skillId"))));
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
      await agent.assignSkill(orgId, decodeURIComponent(c.req.param("profileId")), body),
    );
  });

  app.delete("/v1/profiles/:profileId/skills/:skillId", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    return json<ProfileResponse>(
      await agent.unassignSkill(
        orgId,
        decodeURIComponent(c.req.param("profileId")),
        decodeURIComponent(c.req.param("skillId")),
      ),
    );
  });
}
