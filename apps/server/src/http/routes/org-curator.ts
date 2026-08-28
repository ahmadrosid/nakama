import { createRoute, z } from "@hono/zod-openapi";
import { NakamaApiError } from "@nakama/core";
import type {
  RunSkillCuratorRequest,
  SkillCuratorLatestResponse,
  SkillCuratorRunResponse,
} from "@nakama/core/contract";
import type { ServerOptions } from "../context";
import { requireOrgAdminFromContext } from "../org-guards";
import { json, readOptionalJson } from "../shared";
import type { HonoApp } from "../types";

export function registerOrgCuratorRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { orgService, skillCuratorService } = options;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const orgIdParam = z.object({
    orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
  });
  const runRequestSchema = z
    .object({ dryRun: z.boolean().optional() })
    .openapi("RunSkillCuratorRequest");
  const runResponseSchema = z
    .object({})
    .passthrough()
    .openapi("SkillCuratorRunResponse");
  const latestResponseSchema = z
    .object({})
    .passthrough()
    .openapi("SkillCuratorLatestResponse");

  function resolveOrgId(
    c: { req: { param: (n: string) => string } },
    authOrgId: string
  ): string {
    const orgId = decodeURIComponent(c.req.param("orgId"));
    if (authOrgId !== orgId) {
      throw new NakamaApiError("Not found", 404);
    }
    return orgId;
  }

  function requireCurator() {
    if (!skillCuratorService) {
      throw new NakamaApiError("Skill curator service not configured", 500);
    }
    return skillCuratorService;
  }

  function requireOrgs() {
    if (!orgService) {
      throw new NakamaApiError("Organization service not configured", 500);
    }
    return orgService;
  }

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "runOrgSkillCurator",
      path: "/v1/orgs/{orgId}/curator/run",
      request: {
        body: {
          content: { "application/json": { schema: runRequestSchema } },
          required: false,
        },
        params: orgIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: runResponseSchema } },
          description: "Curator run result",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
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
      summary: "Run the skill curator now",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/curator/run", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const body = await readOptionalJson<RunSkillCuratorRequest>(c.req.raw, {
      dryRun: false,
    });
    const result = await requireCurator().run(orgId, {
      dryRun: body.dryRun === true,
      trigger: "manual",
    });

    if (result.status === "completed" && !result.dryRun) {
      await requireOrgs().markSkillsCuratorRan(orgId, result.finishedAt);
    }

    return json<SkillCuratorRunResponse>({ result });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getOrgSkillCuratorLatest",
      path: "/v1/orgs/{orgId}/curator/latest",
      request: { params: orgIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: latestResponseSchema } },
          description: "Latest curator report",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
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
      summary: "Get the latest skill curator report",
      tags: ["Organizations"],
    })
  );

  app.get("/v1/orgs/:orgId/curator/latest", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const org = await requireOrgs().getOrganization(orgId);
    const result = await requireCurator().readLatest(orgId);
    return json<SkillCuratorLatestResponse>({
      lastRunAt: org?.skillsCuratorLastRunAt ?? result?.finishedAt ?? null,
      result,
    });
  });
}
