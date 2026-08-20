import type {
  ListSkillCuratorOrgsResponse,
  RunSkillCuratorInternalRequest,
  SkillCuratorRunResponse,
} from "@nakama/core/contract";
import type { ServerOptions } from "../context";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerInternalCuratorRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { orgService, skillCuratorService } = options;

  app.get("/v1/internal/curator/orgs", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.mode !== "local-token") {
      return errorResponse("Authentication required", 401);
    }

    if (!orgService) {
      return errorResponse("Organization service not configured", 500);
    }

    const orgs = await orgService.listSkillCuratorOrgs();
    return json<ListSkillCuratorOrgsResponse>({ orgs });
  });

  app.post("/v1/internal/curator/orgs/:orgId/run", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.mode !== "local-token") {
      return errorResponse("Authentication required", 401);
    }

    if (!(orgService && skillCuratorService)) {
      return errorResponse("Skill curator service not configured", 500);
    }

    const orgId = decodeURIComponent(c.req.param("orgId"));
    const organization = await orgService.getOrganization(orgId);
    if (!organization || organization.archivedAt) {
      return errorResponse("Not found", 404);
    }

    const body = await readJson<RunSkillCuratorInternalRequest>(c.req.raw);
    const trigger = body.trigger === "seed" ? "seed" : "schedule";
    const result = await skillCuratorService.run(orgId, { trigger });

    if (result.status === "completed") {
      await orgService.markSkillsCuratorRan(orgId, result.finishedAt);
    }

    return json<SkillCuratorRunResponse>({ result });
  });
}
