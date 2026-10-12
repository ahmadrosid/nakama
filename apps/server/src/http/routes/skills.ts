import { createRoute, z } from "@hono/zod-openapi";
import {
  type ListSkillsResponse,
  type ListSkillVersionsResponse,
  NakamaApiError,
  type ProfileResponse,
  type PublishedSkillResponse,
  type SkillResponse,
  type SyncSkillsResponse,
} from "@nakama/core";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgAdminOrPlatformAdminFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { getRequestAuth, json, readJson } from "../shared";
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

  const publishedSkillSchema = z.object({
    createdAt: z.string(),
    createdBy: z.enum(["agent", "human", "bundled"]),
    description: z.string(),
    disableModelInvocation: z.boolean(),
    enabled: z.boolean(),
    hasTool: z.boolean(),
    id: z.string(),
    name: z.string(),
    updatedAt: z.string(),
    publicationId: z.string(),
    scope: z.literal("parent"),
    sourceOrganization: z.object({ id: z.string(), name: z.string() }),
  });

  const listSkillsSchema = z
    .object({ publishedSkills: z.array(publishedSkillSchema).optional() })
    .passthrough()
    .openapi("ListSkillsResponse");

  const publishedSkillResponseSchema = z
    .object({ skill: publishedSkillSchema.extend({ body: z.string() }) })
    .openapi("PublishedSkillResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getPublishedSkill",
      path: "/v1/orgs/{orgId}/shared-resources/{publicationId}/skill",
      request: {
        params: z.object({ orgId: z.string(), publicationId: z.string() }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: publishedSkillResponseSchema },
          },
          description: "Published skill detail",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Read a published skill through the active organization",
      tags: ["Skills"],
    })
  );
  app.get(
    "/v1/orgs/:orgId/shared-resources/:publicationId/skill",
    async (c) => {
      const auth = getRequestAuth(c);
      const orgId = decodeURIComponent(c.req.param("orgId"));

      if (auth.activeOrgId !== orgId) {
        throw new NakamaApiError("Not found", 404);
      }

      const organization =
        await options.databaseAdapter?.getOrganizationById(orgId);

      if (
        !organization?.parentOrgId &&
        auth.orgRole !== "admin" &&
        !auth.isPlatformAdmin
      ) {
        throw new NakamaApiError("Not found", 404);
      }

      return json<PublishedSkillResponse>(
        await agent.getPublishedSkill(
          orgId,
          decodeURIComponent(c.req.param("publicationId"))
        )
      );
    }
  );

  const skillFilesSchema = z
    .object({
      files: z.array(
        z.object({ path: z.string(), type: z.enum(["file", "directory"]) })
      ),
      truncated: z.boolean(),
    })
    .openapi("SkillFilesResponse");

  const skillFileSchema = z
    .object({
      content: z.string().nullable(),
      image: z
        .object({ mediaType: z.string(), dataBase64: z.string() })
        .optional(),
      path: z.string(),
      unavailableReason: z.string().optional(),
    })
    .openapi("SkillFileResponse");

  for (const [suffix, operationId, summary] of [
    ["files", "listPublishedSkillFiles", "List published skill files"],
    ["file", "readPublishedSkillFile", "Read a published skill file"],
  ] as const) {
    app.openAPIRegistry.registerPath(
      createRoute({
        method: "get",
        operationId,
        path: `/v1/orgs/{orgId}/shared-resources/{publicationId}/skill/${suffix}`,
        request: {
          params: z.object({ orgId: z.string(), publicationId: z.string() }),
          query: suffix === "file" ? z.object({ path: z.string() }) : undefined,
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: suffix === "file" ? skillFileSchema : skillFilesSchema,
              },
            },
            description: summary,
          },
          400: {
            content: { "application/json": { schema: errorSchema } },
            description: "Invalid file path",
          },
          403: {
            content: { "application/json": { schema: errorSchema } },
            description: "File access denied",
          },
          404: {
            content: { "application/json": { schema: errorSchema } },
            description: "Unavailable skill or file",
          },
        },
        summary,
        tags: ["Skills"],
      })
    );
    app.get(
      `/v1/orgs/:orgId/shared-resources/:publicationId/skill/${suffix}`,
      async (c) => {
        const auth = getRequestAuth(c);
        const orgId = decodeURIComponent(c.req.param("orgId"));

        if (auth.activeOrgId !== orgId) {
          throw new NakamaApiError("Not found", 404);
        }

        const organization =
          await options.databaseAdapter?.getOrganizationById(orgId);

        if (
          !organization?.parentOrgId &&
          auth.orgRole !== "admin" &&
          !auth.isPlatformAdmin
        ) {
          throw new NakamaApiError("Not found", 404);
        }

        const publicationId = decodeURIComponent(c.req.param("publicationId"));

        return json(
          suffix === "files"
            ? await agent.listPublishedSkillFiles(orgId, publicationId)
            : await agent.readPublishedSkillFile(
                orgId,
                publicationId,
                c.req.query("path") ?? ""
              )
        );
      }
    );
  }

  const skillSchema = z.object({}).passthrough().openapi("SkillResponse");

  const syncSkillsSchema = z
    .object({})
    .passthrough()
    .openapi("SyncSkillsResponse");

  const createSkillSchema = z
    .object({
      body: z.string().optional(),
      description: z.string(),
      disableModelInvocation: z.boolean().optional(),
      name: z.string(),
      profileId: z.string().optional(),
      scripts: z.array(z.string()).optional(),
    })
    .passthrough()
    .openapi("CreateSkillRequest");

  const installSkillSchema = z
    .object({
      command: z.string().optional(),
      profileId: z.string(),
      url: z.string().optional(),
      zipBase64: z.string().optional(),
    })
    .passthrough()
    .openapi("InstallSkillRequest");

  const patchSkillSchema = z
    .object({
      body: z.string().optional(),
      description: z.string().optional(),
      disableModelInvocation: z.boolean().optional(),
      note: z.string().optional(),
    })
    .passthrough()
    .openapi("PatchSkillRequest");

  const assignSkillSchema = z
    .object({ skillId: z.string() })
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
      operationId: "installSkill",
      path: "/v1/skills/install",
      request: {
        body: {
          content: { "application/json": { schema: installSkillSchema } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: skillSchema } },
          description: "Installed skill",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Install a skill from a public GitHub SKILL.md URL",
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
    requireOrgAdminOrPlatformAdminFromContext(c);

    return json<ListSkillsResponse>(
      await agent.listSkills(requireActiveOrgIdFromContext(c))
    );
  });

  for (const [suffix, operationId, summary] of [
    ["files", "listSkillFiles", "List skill files and folders"],
    ["file", "readSkillFile", "Read a skill file"],
    ["versions", "listSkillVersions", "List SKILL.md versions"],
  ] as const) {
    app.openAPIRegistry.registerPath(
      createRoute({
        method: "get",
        operationId,
        path: `/v1/skills/{skillId}/${suffix}`,
        request: {
          params: skillIdParam,
          query: suffix === "file" ? z.object({ path: z.string() }) : undefined,
        },
        responses: {
          200: {
            description: summary,
            content: {
              "application/json": { schema: z.object({}).passthrough() },
            },
          },
        },
        summary,
        tags: ["Skills"],
      })
    );
  }

  app.get("/v1/skills/:skillId/files", async (c) => {
    requirePlatformAdminFromContext(c);

    return json(
      await agent.listSkillFiles(
        requireActiveOrgIdFromContext(c),
        c.req.param("skillId")
      )
    );
  });

  app.get("/v1/skills/:skillId/file", async (c) => {
    requirePlatformAdminFromContext(c);

    return json(
      await agent.readSkillFile(
        requireActiveOrgIdFromContext(c),
        c.req.param("skillId"),
        c.req.query("path") ?? ""
      )
    );
  });

  app.get("/v1/skills/:skillId/versions", async (c) => {
    requirePlatformAdminFromContext(c);

    return json<ListSkillVersionsResponse>(
      await agent.listSkillVersions(
        requireActiveOrgIdFromContext(c),
        decodeURIComponent(c.req.param("skillId"))
      )
    );
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "restoreSkillVersion",
      path: "/v1/skills/{skillId}/versions/{versionId}/restore",
      request: {
        params: z.object({
          skillId: z
            .string()
            .openapi({ param: { in: "path", name: "skillId" } }),
          versionId: z
            .string()
            .openapi({ param: { in: "path", name: "versionId" } }),
        }),
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
      },
      summary: "Restore a SKILL.md version",
      tags: ["Skills"],
    })
  );

  app.post("/v1/skills/:skillId/versions/:versionId/restore", async (c) => {
    const auth = requirePlatformAdminFromContext(c);

    return json<SkillResponse>(
      await agent.restoreSkillVersion(
        requireActiveOrgIdFromContext(c),
        decodeURIComponent(c.req.param("skillId")),
        decodeURIComponent(c.req.param("versionId")),
        { actorUserId: auth.user.id, source: "dashboard" }
      )
    );
  });

  app.post("/v1/skills", async (c) => {
    const auth = requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson(c.req.raw, createSkillSchema);

    return json<SkillResponse>(
      await agent.createSkill(orgId, body, {
        meta: { actorUserId: auth.user.id, source: "dashboard" },
      })
    );
  });

  app.post("/v1/skills/install", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson(c.req.raw, installSkillSchema);

    return json<SkillResponse>(
      await agent.installSkillFromGitHub(orgId, body),
      201
    );
  });

  app.post("/v1/skills/sync", async (c) => {
    requirePlatformAdminFromContext(c);

    return json<SyncSkillsResponse>(await agent.syncSkills());
  });

  app.get("/v1/skills/:skillId", async (c) => {
    requirePlatformAdminFromContext(c);

    return json<SkillResponse>(
      await agent.getSkill(
        decodeURIComponent(c.req.param("skillId")),
        requireActiveOrgIdFromContext(c)
      )
    );
  });

  app.patch("/v1/skills/:skillId", async (c) => {
    const auth = requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const skillId = decodeURIComponent(c.req.param("skillId"));
    const existing = await agent.getSkill(skillId);

    if (existing.skill.pluginId) {
      throw new NakamaApiError("Plugin-owned skills cannot be edited.", 409);
    }

    const body = await readJson(c.req.raw, patchSkillSchema);
    const profileId = c.req.query("profileId")?.trim() || undefined;

    return json<SkillResponse>(
      await agent.patchSkill(orgId, skillId, body, {
        meta: { actorUserId: auth.user.id, source: "dashboard" },
        profileId,
      })
    );
  });

  app.delete("/v1/skills/:skillId", async (c) => {
    requirePlatformAdminFromContext(c);
    const skillId = decodeURIComponent(c.req.param("skillId"));
    const existing = await agent.getSkill(skillId);

    if (existing.skill.pluginId) {
      throw new NakamaApiError("Plugin-owned skills cannot be deleted.", 409);
    }

    await agent.deleteSkill(skillId);

    return new Response(null, { status: 204 });
  });

  app.post("/v1/profiles/:profileId/skills", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson(c.req.raw, assignSkillSchema);

    return json<ProfileResponse>(
      await agent.assignSkill(
        orgId,
        decodeURIComponent(c.req.param("profileId")),
        body,
        { actorUserId: auth.user.id, source: "dashboard" }
      )
    );
  });

  app.delete("/v1/profiles/:profileId/skills/:skillId", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);

    return json<ProfileResponse>(
      await agent.unassignSkill(
        orgId,
        decodeURIComponent(c.req.param("profileId")),
        decodeURIComponent(c.req.param("skillId")),
        { actorUserId: auth.user.id, source: "dashboard" }
      )
    );
  });
}
