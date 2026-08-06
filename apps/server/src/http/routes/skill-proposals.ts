import { createRoute, z } from "@hono/zod-openapi";
import { NakamaApiError } from "@nakama/core";
import type {
  ListSkillProposalsResponse,
  SkillProposalResponse,
} from "@nakama/core/contract";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";
import { json } from "../shared";
import {
  requireNotViewerFromContext,
  requireOrgAdminFromContext,
} from "../org-guards";
import { SkillProposalService, toSkillProposal } from "../../services/skill-proposal-service";

export function registerSkillProposalRoutes(app: HonoApp, options: ServerOptions): void {
  const skillProposalService = options.skillProposalService;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const orgIdParam = z.object({
    orgId: z.string().openapi({ param: { name: "orgId", in: "path" } }),
  });
  const listSkillProposalsResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ListSkillProposalsResponse");
  const skillProposalResponseSchema = z
    .object({})
    .passthrough()
    .openapi("SkillProposalResponse");

  function resolveOrgId(c: { req: { param: (n: string) => string } }, authOrgId: string): string {
    const orgId = decodeURIComponent(c.req.param("orgId"));
    if (authOrgId !== orgId) {
      throw new NakamaApiError("Not found", 404);
    }
    return orgId;
  }

  function requireService(): SkillProposalService {
    if (!skillProposalService) {
      throw new NakamaApiError("Skill proposal service not configured", 500);
    }
    return skillProposalService;
  }

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/orgs/{orgId}/skill-proposals",
      tags: ["Organizations"],
      summary: "List skill proposals",
      operationId: "listSkillProposals",
      request: {
        params: orgIdParam,
        query: z.object({
          status: z.enum(["pending", "approved", "rejected"]).optional(),
          profileId: z.string().optional(),
          sessionId: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: "Skill proposals",
          content: { "application/json": { schema: listSkillProposalsResponseSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.get("/v1/orgs/:orgId/skill-proposals", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const status = c.req.query("status") as "pending" | "approved" | "rejected" | undefined;
    const profileId = c.req.query("profileId");
    const sessionId = c.req.query("sessionId");
    const isOrgAdmin = auth.orgRole === "admin" || auth.isPlatformAdmin;
    if (!isOrgAdmin && !sessionId) {
      throw new NakamaApiError("Forbidden", 403);
    }
    const result = await service.listProposals(orgId, {
      status,
      profileId: profileId || undefined,
      sessionId: sessionId || undefined,
    });
    return json<ListSkillProposalsResponse>({
      proposals: result.proposals.map(toSkillProposal),
      pendingCount: result.pendingCount,
    });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/skill-proposals/{proposalId}/approve",
      tags: ["Organizations"],
      summary: "Approve a skill proposal",
      operationId: "approveSkillProposal",
      request: {
        params: orgIdParam.extend({
          proposalId: z.string().openapi({ param: { name: "proposalId", in: "path" } }),
        }),
      },
      responses: {
        200: {
          description: "Approved",
          content: { "application/json": { schema: skillProposalResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/orgs/:orgId/skill-proposals/:proposalId/approve", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const proposalId = decodeURIComponent(c.req.param("proposalId"));
    const service = requireService();
    const proposal = await service.approveProposal(orgId, proposalId, auth.user.id);
    return json<SkillProposalResponse>({ proposal: toSkillProposal(proposal) });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/skill-proposals/{proposalId}/reject",
      tags: ["Organizations"],
      summary: "Reject a skill proposal",
      operationId: "rejectSkillProposal",
      request: {
        params: orgIdParam.extend({
          proposalId: z.string().openapi({ param: { name: "proposalId", in: "path" } }),
        }),
      },
      responses: {
        200: {
          description: "Rejected",
          content: { "application/json": { schema: skillProposalResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/orgs/:orgId/skill-proposals/:proposalId/reject", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const proposalId = decodeURIComponent(c.req.param("proposalId"));
    const service = requireService();
    const proposal = await service.rejectProposal(orgId, proposalId, auth.user.id);
    return json<SkillProposalResponse>({ proposal: toSkillProposal(proposal) });
  });
}
