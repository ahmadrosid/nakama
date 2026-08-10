import { createRoute, z } from "@hono/zod-openapi";
import type {
  AutomationResponse,
  CreateAutomationRequest,
  DraftAutomationRequest,
  DraftAutomationResponse,
  ListAutomationRunsResponse,
  ListAutomationsResponse,
  MarkAutomationRunsReadResponse,
  RunAutomationResponse,
  UpdateAutomationRequest,
} from "@nakama/core";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
} from "../org-guards";
import {
  errorResponse,
  getRequestAuth,
  json,
  parseChannel,
  readJson,
} from "../shared";
import type { HonoApp } from "../types";

export function registerAutomationRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent, automationService } = options;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const automationIdParam = z.object({
    automationId: z
      .string()
      .openapi({ param: { in: "path", name: "automationId" } }),
  });
  const automationRunParam = automationIdParam.extend({
    runId: z.string().openapi({ param: { in: "path", name: "runId" } }),
  });
  const draftAutomationSchema = z
    .object({})
    .passthrough()
    .openapi("DraftAutomationRequest");
  const draftAutomationResponseSchema = z
    .object({})
    .passthrough()
    .openapi("DraftAutomationResponse");
  const listAutomationsSchema = z
    .object({})
    .passthrough()
    .openapi("ListAutomationsResponse");
  const createAutomationSchema = z
    .object({})
    .passthrough()
    .openapi("CreateAutomationRequest");
  const automationSchema = z
    .object({})
    .passthrough()
    .openapi("AutomationResponse");
  const updateAutomationSchema = z
    .object({})
    .passthrough()
    .openapi("UpdateAutomationRequest");
  const runAutomationSchema = z
    .object({})
    .passthrough()
    .openapi("RunAutomationResponse");
  const listAutomationRunsSchema = z
    .object({})
    .passthrough()
    .openapi("ListAutomationRunsResponse");
  const markAutomationRunsReadSchema = z
    .object({})
    .passthrough()
    .openapi("MarkAutomationRunsReadResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "draftAutomation",
      path: "/v1/automations/draft",
      request: {
        body: {
          content: { "application/json": { schema: draftAutomationSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: draftAutomationResponseSchema },
          },
          description: "Automation draft",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Draft an automation from a prompt",
      tags: ["Automations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listAutomations",
      path: "/v1/automations",
      responses: {
        200: {
          content: { "application/json": { schema: listAutomationsSchema } },
          description: "Saved automations",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "List saved automations",
      tags: ["Automations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createAutomation",
      path: "/v1/automations",
      request: {
        body: {
          content: { "application/json": { schema: createAutomationSchema } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: automationSchema } },
          description: "Automation created",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Create a saved automation",
      tags: ["Automations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getAutomation",
      path: "/v1/automations/{automationId}",
      request: { params: automationIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: automationSchema } },
          description: "Automation",
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
      summary: "Get a saved automation",
      tags: ["Automations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      operationId: "updateAutomation",
      path: "/v1/automations/{automationId}",
      request: {
        body: {
          content: { "application/json": { schema: updateAutomationSchema } },
          required: true,
        },
        params: automationIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: automationSchema } },
          description: "Automation updated",
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
      summary: "Update a saved automation",
      tags: ["Automations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteAutomation",
      path: "/v1/automations/{automationId}",
      request: { params: automationIdParam },
      responses: {
        204: { description: "Automation deleted" },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete a saved automation",
      tags: ["Automations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "runAutomation",
      path: "/v1/automations/{automationId}/run",
      request: { params: automationIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: runAutomationSchema } },
          description: "Automation run",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Run an automation now",
      tags: ["Automations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listAutomationRuns",
      path: "/v1/automations/{automationId}/runs",
      request: { params: automationIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: listAutomationRunsSchema } },
          description: "Automation runs",
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
      summary: "List automation run history",
      tags: ["Automations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "markAutomationRunsRead",
      path: "/v1/automations/{automationId}/runs/mark-read",
      request: { params: automationIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: markAutomationRunsReadSchema },
          },
          description: "Automation runs marked read",
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
      summary: "Mark automation runs as read for the current user",
      tags: ["Automations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteAutomationRun",
      path: "/v1/automations/{automationId}/runs/{runId}",
      request: { params: automationRunParam },
      responses: {
        204: { description: "Automation run deleted" },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete an automation run history item",
      tags: ["Automations"],
    })
  );

  app.post("/v1/automations/draft", async (c) => {
    requireNotViewerFromContext(c);
    const body = await readJson<DraftAutomationRequest>(c.req.raw);
    const automation = await agent.draftAutomation(
      body.prompt,
      parseChannel(body.channel)
    );
    return json<DraftAutomationResponse>({ automation });
  });

  app.get("/v1/automations", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const auth = getRequestAuth(c);
    const result = await automationService.listForOrg(orgId, auth.user.id);
    return json<ListAutomationsResponse>(result);
  });

  app.post("/v1/automations", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<CreateAutomationRequest>(c.req.raw);
    const automation = await automationService.create(
      orgId,
      body,
      body.profileId,
      {
        isPlatformAdmin: auth.isPlatformAdmin,
        orgRole: auth.orgRole,
      }
    );
    return json<AutomationResponse>({ automation }, 201);
  });

  app.get("/v1/automations/:automationId", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const automation = await automationService.get(
      decodeURIComponent(c.req.param("automationId")),
      orgId
    );
    if (!automation) {
      return errorResponse("Automation not found", 404);
    }
    return json<AutomationResponse>({ automation });
  });

  app.put("/v1/automations/:automationId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const automationId = decodeURIComponent(c.req.param("automationId"));
    const body = await readJson<UpdateAutomationRequest>(c.req.raw);

    try {
      const automation = await automationService.update(
        automationId,
        orgId,
        body
      );
      return json<AutomationResponse>({ automation });
    } catch (error) {
      if (error instanceof Error && error.message === "Automation not found.") {
        return errorResponse(error.message, 404);
      }
      throw error;
    }
  });

  app.delete("/v1/automations/:automationId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const deleted = await automationService.delete(
      decodeURIComponent(c.req.param("automationId")),
      orgId
    );
    if (!deleted) {
      return errorResponse("Automation not found", 404);
    }
    return new Response(null, { status: 204 });
  });

  app.post("/v1/automations/:automationId/run", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const auth = getRequestAuth(c);
    const automationId = decodeURIComponent(c.req.param("automationId"));
    const automation = await automationService.get(automationId, orgId);

    if (!automation) {
      return errorResponse("Automation not found", 404);
    }

    const result = await agent.runAutomation(automationId);

    if (result.skipped) {
      return errorResponse(result.error ?? "Automation run skipped.", 409);
    }

    const runs = await automationService.listRuns(
      automationId,
      orgId,
      1,
      auth.user.id
    );
    const run = runs[0];
    if (!run) {
      return errorResponse("Automation run record not found.", 500);
    }

    return json<RunAutomationResponse>({ run });
  });

  app.get("/v1/automations/:automationId/runs", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const auth = getRequestAuth(c);
    const automationId = decodeURIComponent(c.req.param("automationId"));

    try {
      const runs = await automationService.listRuns(
        automationId,
        orgId,
        20,
        auth.user.id
      );
      return json<ListAutomationRunsResponse>({ runs });
    } catch (error) {
      if (error instanceof Error && error.message === "Automation not found.") {
        return errorResponse(error.message, 404);
      }
      throw error;
    }
  });

  app.delete("/v1/automations/:automationId/runs/:runId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const automationId = decodeURIComponent(c.req.param("automationId"));
    const runId = decodeURIComponent(c.req.param("runId"));

    try {
      const deleted = await automationService.deleteRun(
        automationId,
        runId,
        orgId
      );
      if (!deleted) {
        return errorResponse("Automation run not found.", 404);
      }
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof Error && error.message === "Automation not found.") {
        return errorResponse(error.message, 404);
      }
      throw error;
    }
  });

  app.post("/v1/automations/:automationId/runs/mark-read", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const auth = getRequestAuth(c);
    const automationId = decodeURIComponent(c.req.param("automationId"));

    try {
      const result = await automationService.markRunsRead(
        automationId,
        orgId,
        auth.user.id
      );
      return json<MarkAutomationRunsReadResponse>(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Automation not found.") {
        return errorResponse(error.message, 404);
      }
      throw error;
    }
  });
}
