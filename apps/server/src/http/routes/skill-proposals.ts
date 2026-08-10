import { createRoute, z } from "@hono/zod-openapi";
import { NakamaApiError } from "@nakama/core";
import type {
  ListSkillProposalsResponse,
  SkillProposalResponse,
} from "@nakama/core/contract";
import {
  type SkillProposalService,
  toSkillProposal,
} from "../../services/skill-proposal-service";
import type { ServerOptions } from "../context";
import {
  requireNotViewerFromContext,
  requireOrgAdminFromContext,
} from "../org-guards";
import { json } from "../shared";
import type { HonoApp } from "../types";

export function registerSkillProposalRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const skillProposalService = options.skillProposalService;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const orgIdParam = z.object({
    orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
  });
  const listSkillProposalsResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ListSkillProposalsResponse");
  const skillProposalResponseSchema = z
    .object({})
    .passthrough()
    .openapi("SkillProposalResponse");

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

  function requireService(): SkillProposalService {
    if (!skillProposalService) {
      throw new NakamaApiError("Skill proposal service not configured", 500);
    }
    return skillProposalService;
  }

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listSkillProposals",
      path: "/v1/orgs/{orgId}/skill-proposals",
      request: {
        params: orgIdParam,
        query: z.object({
          profileId: z.string().optional(),
          sessionId: z.string().optional(),
          status: z.enum(["pending", "approved", "rejected"]).optional(),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: listSkillProposalsResponseSchema },
          },
          description: "Skill proposals",
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
      summary: "List skill proposals",
      tags: ["Organizations"],
    })
  );

  app.get("/v1/orgs/:orgId/skill-proposals", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const status = c.req.query("status") as
      | "pending"
      | "approved"
      | "rejected"
      | undefined;
    const profileId = c.req.query("profileId");
    const sessionId = c.req.query("sessionId");
    const isOrgAdmin = auth.orgRole === "admin" || auth.isPlatformAdmin;
    if (!(isOrgAdmin || sessionId)) {
      throw new NakamaApiError("Forbidden", 403);
    }
    const result = await service.listProposals(orgId, {
      profileId: profileId || undefined,
      sessionId: sessionId || undefined,
      status,
    });
    return json<ListSkillProposalsResponse>({
      pendingCount: result.pendingCount,
      proposals: result.proposals.map(toSkillProposal),
    });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "approveSkillProposal",
      path: "/v1/orgs/{orgId}/skill-proposals/{proposalId}/approve",
      request: {
        params: orgIdParam.extend({
          proposalId: z
            .string()
            .openapi({ param: { in: "path", name: "proposalId" } }),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: skillProposalResponseSchema },
          },
          description: "Approved",
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
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Approve a skill proposal",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/skill-proposals/:proposalId/approve", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const proposalId = decodeURIComponent(c.req.param("proposalId"));
    const service = requireService();
    const proposal = await service.approveProposal(
      orgId,
      proposalId,
      auth.user.id
    );
    return json<SkillProposalResponse>({ proposal: toSkillProposal(proposal) });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "rejectSkillProposal",
      path: "/v1/orgs/{orgId}/skill-proposals/{proposalId}/reject",
      request: {
        params: orgIdParam.extend({
          proposalId: z
            .string()
            .openapi({ param: { in: "path", name: "proposalId" } }),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: skillProposalResponseSchema },
          },
          description: "Rejected",
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
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Reject a skill proposal",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/skill-proposals/:proposalId/reject", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const proposalId = decodeURIComponent(c.req.param("proposalId"));
    const service = requireService();
    const proposal = await service.rejectProposal(
      orgId,
      proposalId,
      auth.user.id
    );
    return json<SkillProposalResponse>({ proposal: toSkillProposal(proposal) });
  });
}
