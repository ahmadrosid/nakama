import { createRoute, z } from "@hono/zod-openapi";
import type {
  CodingAgentLaunchPlanResponse,
  PrepareCodingAgentLaunchRequest,
} from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import { json, readJson, errorResponse } from "../shared";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
} from "../org-guards";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";

export function registerCodingAgentRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const prepareLaunchRequestSchema = z
    .object({})
    .passthrough()
    .openapi("PrepareCodingAgentLaunchRequest");
  const launchPlanSchema = z.object({}).passthrough().openapi("CodingAgentLaunchPlanResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/coding-agents/prepare-launch",
      tags: ["Coding agents"],
      summary: "Prepare a direct coding-agent launch plan",
      operationId: "prepareCodingAgentLaunch",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: prepareLaunchRequestSchema } },
        },
      },
      responses: {
        200: {
          description: "Launch plan",
          content: { "application/json": { schema: launchPlanSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/coding-agents/prepare-launch", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<PrepareCodingAgentLaunchRequest>(c.req.raw);

    try {
      const plan = await agent.prepareCodingAgentLaunch(orgId, body, {
        persistSelection: body.persistSelection === true && (auth.orgRole === "admin" || auth.isPlatformAdmin),
        orgRole: auth.orgRole,
        isPlatformAdmin: auth.isPlatformAdmin,
        localCli: auth.mode === "local-token",
      });

      return json<CodingAgentLaunchPlanResponse>(plan);
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });
}
