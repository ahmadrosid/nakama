import { createRoute, z } from "@hono/zod-openapi";
import type {
  CreateWorkflowRequest,
  GetWorkflowRunResponse,
  ListWorkflowRunsResponse,
  ListWorkflowsResponse,
  RunWorkflowRequest,
  RunWorkflowResponse,
  UpdateWorkflowRequest,
  WorkflowResponse,
} from "@nakama/core";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
} from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerWorkflowRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent, workflowService } = options;

  app.get("/v1/workflows", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const workflows = await workflowService.listForOrg(orgId);
    return json<ListWorkflowsResponse>({ workflows });
  });

  app.post("/v1/workflows", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<CreateWorkflowRequest>(c.req.raw);
    const profileId = body.profileId?.trim();
    const allowedTools = await agent.resolveWorkflowToolNames(
      orgId,
      profileId || (await resolveDefaultProfileId(agent, orgId))
    );
    const workflow = await workflowService.create(
      orgId,
      body,
      body.profileId,
      {
        isPlatformAdmin: auth.isPlatformAdmin,
        orgRole: auth.orgRole,
      },
      allowedTools
    );
    return json<WorkflowResponse>({ workflow }, 201);
  });

  app.get("/v1/workflows/:workflowId", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const workflow = await workflowService.get(
      decodeURIComponent(c.req.param("workflowId")),
      orgId
    );
    if (!workflow) {
      return errorResponse("Workflow not found", 404);
    }
    return json<WorkflowResponse>({ workflow });
  });

  app.put("/v1/workflows/:workflowId", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const workflowId = decodeURIComponent(c.req.param("workflowId"));
    const body = await readJson<UpdateWorkflowRequest>(c.req.raw);
    const existing = await workflowService.get(workflowId, orgId);
    if (!existing) {
      return errorResponse("Workflow not found", 404);
    }

    const profileId = body.profileId?.trim() || existing.profileId;
    const allowedTools = await agent.resolveWorkflowToolNames(orgId, profileId);

    try {
      const workflow = await workflowService.update(
        workflowId,
        orgId,
        body,
        {
          isPlatformAdmin: auth.isPlatformAdmin,
          orgRole: auth.orgRole,
        },
        allowedTools
      );
      return json<WorkflowResponse>({ workflow });
    } catch (error) {
      return mapWorkflowMutationError(error);
    }
  });

  app.delete("/v1/workflows/:workflowId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const deleted = await workflowService.delete(
      decodeURIComponent(c.req.param("workflowId")),
      orgId
    );
    if (!deleted) {
      return errorResponse("Workflow not found", 404);
    }
    return new Response(null, { status: 204 });
  });

  app.post("/v1/workflows/:workflowId/run", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const workflowId = decodeURIComponent(c.req.param("workflowId"));
    const workflow = await workflowService.get(workflowId, orgId);
    if (!workflow) {
      return errorResponse("Workflow not found", 404);
    }

    const body = await readJson<RunWorkflowRequest>(c.req.raw).catch(() => ({
      input: {},
    }));
    const result = await agent.runWorkflow(workflowId, body.input ?? {});

    if (result.skipped) {
      return errorResponse(result.error ?? "Workflow run skipped.", 409);
    }

    const runs = await workflowService.listRuns(workflowId, orgId, 1);
    const run = runs[0];
    if (!run) {
      return errorResponse("Workflow run record not found.", 500);
    }

    return json<RunWorkflowResponse>({ run });
  });

  app.get("/v1/workflows/:workflowId/runs", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const workflowId = decodeURIComponent(c.req.param("workflowId"));

    try {
      const runs = await workflowService.listRuns(workflowId, orgId, 20);
      return json<ListWorkflowRunsResponse>({ runs });
    } catch (error) {
      if (error instanceof Error && error.message === "Workflow not found.") {
        return errorResponse(error.message, 404);
      }
      throw error;
    }
  });

  app.get("/v1/workflows/:workflowId/runs/:runId", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const workflowId = decodeURIComponent(c.req.param("workflowId"));
    const runId = decodeURIComponent(c.req.param("runId"));
    const run = await workflowService.getRun(workflowId, runId, orgId, true);
    if (!run) {
      return errorResponse("Workflow run not found", 404);
    }
    return json<GetWorkflowRunResponse>({ run });
  });

  app.delete("/v1/workflows/:workflowId/runs/:runId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const workflowId = decodeURIComponent(c.req.param("workflowId"));
    const runId = decodeURIComponent(c.req.param("runId"));

    try {
      const deleted = await workflowService.deleteRun(workflowId, runId, orgId);
      if (!deleted) {
        return errorResponse("Workflow run not found", 404);
      }
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof Error && error.message === "Workflow not found.") {
        return errorResponse(error.message, 404);
      }
      throw error;
    }
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listWorkflows",
      path: "/v1/workflows",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z
                .object({})
                .passthrough()
                .openapi("ListWorkflowsResponse"),
            },
          },
          description: "Workflow list",
        },
      },
      summary: "List workflows",
      tags: ["Workflows"],
    })
  );
}

async function resolveDefaultProfileId(
  agent: ServerOptions["agent"],
  orgId: string
): Promise<string> {
  const profiles = await agent.listProfiles(orgId);
  const defaultProfile = profiles.profiles.find((profile) => profile.isDefault);
  if (!defaultProfile) {
    throw new Error("No default profile exists for this organization.");
  }
  return defaultProfile.id;
}

function mapWorkflowMutationError(error: unknown): Response {
  if (error instanceof Error) {
    if (error.message === "Workflow not found.") {
      return errorResponse(error.message, 404);
    }

    const badRequestMessages = new Set([
      "Profile not found.",
      "Profile id is required.",
      "No default profile exists for this organization.",
    ]);

    if (
      badRequestMessages.has(error.message) ||
      error.message.includes("Workflow") ||
      error.message.includes("step") ||
      error.message.includes("tool")
    ) {
      return errorResponse(error.message, 400);
    }
  }

  throw error;
}
