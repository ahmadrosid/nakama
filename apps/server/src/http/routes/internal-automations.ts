import {
  type AutomationSchedule,
  isWorkerSchedulable,
  type StoredAutomation,
} from "@nakama/core";
import type { ServerOptions } from "../context";
import { errorResponse, json } from "../shared";
import type { HonoApp } from "../types";

export function registerInternalAutomationRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent, automationService, orgService } = options;

  app.get("/v1/internal/automations/schedules", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.mode !== "local-token") {
      return errorResponse("Authentication required", 401);
    }

    // Use one request-time snapshot so a runAt that becomes due while the
    // response is assembled is still returned inside the scheduler's grace window.
    const now = Date.now();

    const automations = await automationService.listAll();
    const archivedOrgIds = new Set(
      orgService
        ? (await orgService.listOrganizations())
            .filter((organization) => organization.archivedAt)
            .map((organization) => organization.id)
        : []
    );
    // Org-less rows can only be pre-tenant legacy data; the run route 400s a
    // missing org now, so the worker must never receive an id it cannot run.
    const schedules: AutomationSchedule[] = automations
      .filter(
        (automation): automation is StoredAutomation & { orgId: string } =>
          isWorkerSchedulable(automation, now) &&
          Boolean(automation.orgId) &&
          !archivedOrgIds.has(automation.orgId)
      )
      .map((automation) => {
        if (automation.trigger.type === "runAt") {
          return {
            id: automation.id,
            orgId: automation.orgId,
            profileId: automation.profileId,
            runAt: automation.trigger.at,
            timezone: automation.trigger.timezone ?? null,
          };
        }

        if (automation.trigger.type === "schedule") {
          return {
            cron: automation.trigger.cron,
            id: automation.id,
            orgId: automation.orgId,
            profileId: automation.profileId,
            timezone: automation.trigger.timezone ?? null,
          };
        }

        throw new Error(
          `Unexpected schedulable trigger for automation ${automation.id}.`
        );
      });

    return json(schedules);
  });

  app.post("/v1/internal/automations/:automationId/run", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.mode !== "local-token") {
      return errorResponse("Authentication required", 401);
    }

    const automationId = decodeURIComponent(c.req.param("automationId"));
    const orgId = c.req.query("orgId")?.trim();
    if (!orgId) {
      return errorResponse("orgId query parameter is required.", 400);
    }

    const automation = await automationService.get(automationId, orgId);

    if (!automation) {
      return errorResponse("Automation not found", 404);
    }

    if (automation.orgId && orgService) {
      const organization = await orgService.getOrganization(automation.orgId);
      if (!organization || organization.archivedAt) {
        return errorResponse("Not found", 404);
      }
    }

    const result = await agent.runAutomation(automationId);

    console.log(
      `[automation-worker] run automation=${automationId} org=${automation.orgId} profile=${automation.profileId} skipped=${result.skipped ?? false}`
    );

    if (result.skipped) {
      return errorResponse(result.error ?? "Automation run skipped.", 409);
    }

    return new Response(null, { status: 204 });
  });
}
