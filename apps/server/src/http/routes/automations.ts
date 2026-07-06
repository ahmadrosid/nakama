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
import { errorResponse, getRequestAuth, json, parseChannel, readJson } from "../shared";
import { requireActiveOrgIdFromContext } from "../org-guards";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";

export function registerAutomationRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent, automationService } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const automationIdParam = z.object({
    automationId: z.string().openapi({ param: { name: "automationId", in: "path" } }),
  });
  const automationRunParam = automationIdParam.extend({
    runId: z.string().openapi({ param: { name: "runId", in: "path" } }),
  });
  const draftAutomationSchema = z.object({}).passthrough().openapi("DraftAutomationRequest");
  const draftAutomationResponseSchema = z.object({}).passthrough().openapi("DraftAutomationResponse");
  const listAutomationsSchema = z.object({}).passthrough().openapi("ListAutomationsResponse");
  const createAutomationSchema = z.object({}).passthrough().openapi("CreateAutomationRequest");
  const automationSchema = z.object({}).passthrough().openapi("AutomationResponse");
  const updateAutomationSchema = z.object({}).passthrough().openapi("UpdateAutomationRequest");
  const runAutomationSchema = z.object({}).passthrough().openapi("RunAutomationResponse");
  const listAutomationRunsSchema = z.object({}).passthrough().openapi("ListAutomationRunsResponse");
  const markAutomationRunsReadSchema = z
    .object({})
    .passthrough()
    .openapi("MarkAutomationRunsReadResponse");

  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/automations/draft",
    tags: ["Automations"],
    summary: "Draft an automation from a prompt",
    operationId: "draftAutomation",
    request: { body: { required: true, content: { "application/json": { schema: draftAutomationSchema } } } },
    responses: {
      200: { description: "Automation draft", content: { "application/json": { schema: draftAutomationResponseSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/automations",
    tags: ["Automations"],
    summary: "List saved automations",
    operationId: "listAutomations",
    responses: {
      200: { description: "Saved automations", content: { "application/json": { schema: listAutomationsSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/automations",
    tags: ["Automations"],
    summary: "Create a saved automation",
    operationId: "createAutomation",
    request: { body: { required: true, content: { "application/json": { schema: createAutomationSchema } } } },
    responses: {
      201: { description: "Automation created", content: { "application/json": { schema: automationSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/automations/{automationId}",
    tags: ["Automations"],
    summary: "Get a saved automation",
    operationId: "getAutomation",
    request: { params: automationIdParam },
    responses: {
      200: { description: "Automation", content: { "application/json": { schema: automationSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/automations/{automationId}",
    tags: ["Automations"],
    summary: "Update a saved automation",
    operationId: "updateAutomation",
    request: { params: automationIdParam, body: { required: true, content: { "application/json": { schema: updateAutomationSchema } } } },
    responses: {
      200: { description: "Automation updated", content: { "application/json": { schema: automationSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/automations/{automationId}",
    tags: ["Automations"],
    summary: "Delete a saved automation",
    operationId: "deleteAutomation",
    request: { params: automationIdParam },
    responses: {
      204: { description: "Automation deleted" },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/automations/{automationId}/run",
    tags: ["Automations"],
    summary: "Run an automation now",
    operationId: "runAutomation",
    request: { params: automationIdParam },
    responses: {
      200: { description: "Automation run", content: { "application/json": { schema: runAutomationSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/automations/{automationId}/runs",
    tags: ["Automations"],
    summary: "List automation run history",
    operationId: "listAutomationRuns",
    request: { params: automationIdParam },
    responses: {
      200: { description: "Automation runs", content: { "application/json": { schema: listAutomationRunsSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/automations/{automationId}/runs/mark-read",
    tags: ["Automations"],
    summary: "Mark automation runs as read for the current user",
    operationId: "markAutomationRunsRead",
    request: { params: automationIdParam },
    responses: {
      200: {
        description: "Automation runs marked read",
        content: { "application/json": { schema: markAutomationRunsReadSchema } },
      },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/automations/{automationId}/runs/{runId}",
    tags: ["Automations"],
    summary: "Delete an automation run history item",
    operationId: "deleteAutomationRun",
    request: { params: automationRunParam },
    responses: {
      204: { description: "Automation run deleted" },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));

  app.post("/v1/automations/draft", async (c) => {
    const body = await readJson<DraftAutomationRequest>(c.req.raw);
    const automation = await agent.draftAutomation(body.prompt, parseChannel(body.channel));
    return json<DraftAutomationResponse>({ automation });
  });

  app.get("/v1/automations", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const auth = getRequestAuth(c);
    const result = await automationService.listForOrg(orgId, auth.user.id);
    return json<ListAutomationsResponse>(result);
  });

  app.post("/v1/automations", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<CreateAutomationRequest>(c.req.raw);
    const automation = await automationService.create(orgId, body, body.profileId);
    return json<AutomationResponse>({ automation }, 201);
  });

  app.get("/v1/automations/:automationId", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const automation = await automationService.get(
      decodeURIComponent(c.req.param("automationId")),
      orgId,
    );
    if (!automation) {
      return errorResponse("Automation not found", 404);
    }
    return json<AutomationResponse>({ automation });
  });

  app.put("/v1/automations/:automationId", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const automationId = decodeURIComponent(c.req.param("automationId"));
    const body = await readJson<UpdateAutomationRequest>(c.req.raw);

    try {
      const automation = await automationService.update(automationId, orgId, body);
      return json<AutomationResponse>({ automation });
    } catch (error) {
      if (error instanceof Error && error.message === "Automation not found.") {
        return errorResponse(error.message, 404);
      }
      throw error;
    }
  });

  app.delete("/v1/automations/:automationId", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const deleted = await automationService.delete(
      decodeURIComponent(c.req.param("automationId")),
      orgId,
    );
    if (!deleted) {
      return errorResponse("Automation not found", 404);
    }
    return new Response(null, { status: 204 });
  });

  app.post("/v1/automations/:automationId/run", async (c) => {
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

    const runs = await automationService.listRuns(automationId, orgId, 1, auth.user.id);
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
      const runs = await automationService.listRuns(automationId, orgId, 20, auth.user.id);
      return json<ListAutomationRunsResponse>({ runs });
    } catch (error) {
      if (error instanceof Error && error.message === "Automation not found.") {
        return errorResponse(error.message, 404);
      }
      throw error;
    }
  });

  app.delete("/v1/automations/:automationId/runs/:runId", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const automationId = decodeURIComponent(c.req.param("automationId"));
    const runId = decodeURIComponent(c.req.param("runId"));

    try {
      const deleted = await automationService.deleteRun(automationId, runId, orgId);
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
      const result = await automationService.markRunsRead(automationId, orgId, auth.user.id);
      return json<MarkAutomationRunsReadResponse>(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Automation not found.") {
        return errorResponse(error.message, 404);
      }
      throw error;
    }
  });
}
