import { createRoute, z } from "@hono/zod-openapi";
import { NakamaApiError } from "@nakama/core";
import type {
  AddOrgMemoryFactRequest,
  ArchiveOrgMemoryRequest,
  ArchiveOrgMemoryResponse,
  OrgMemoryResponse,
  OrgMemorySearchRequest,
  OrgMemorySearchResponse,
  PinOrgMemoryRequest,
  UnpinOrgMemoryRequest,
  UpdateOrgMemoryRequest,
} from "@nakama/core/contract";
import type { ServerOptions } from "../context";
import {
  requireNotViewerFromContext,
  requireOrgAdminFromContext,
} from "../org-guards";
import { json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerOrgMemoryRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const orgMemoryService = options.orgMemoryService;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const orgIdParam = z.object({
    orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
  });
  const orgMemoryResponseSchema = z
    .object({})
    .passthrough()
    .openapi("OrgMemoryResponse");
  const updateOrgMemorySchema = z
    .object({ content: z.string() })
    .openapi("UpdateOrgMemoryRequest");
  const addOrgMemoryFactSchema = z
    .object({ bullet: z.string(), pin: z.boolean().optional() })
    .openapi("AddOrgMemoryFactRequest");
  const orgMemorySearchSchema = z
    .object({ query: z.string() })
    .openapi("OrgMemorySearchRequest");
  const orgMemorySearchResponseSchema = z
    .object({})
    .passthrough()
    .openapi("OrgMemorySearchResponse");
  const archiveOrgMemorySchema = z
    .object({ entries: z.array(z.string()), reason: z.string().optional() })
    .openapi("ArchiveOrgMemoryRequest");
  const archiveOrgMemoryResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ArchiveOrgMemoryResponse");
  const pinOrgMemorySchema = z
    .object({ bullet: z.string() })
    .openapi("PinOrgMemoryRequest");
  const unpinOrgMemorySchema = z
    .object({ bullet: z.string() })
    .openapi("UnpinOrgMemoryRequest");

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

  function requireService() {
    if (!orgMemoryService) {
      throw new NakamaApiError("Org memory service not configured", 500);
    }
    return orgMemoryService;
  }

  // GET /v1/orgs/{orgId}/memory — admin + member
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getOrgMemory",
      path: "/v1/orgs/{orgId}/memory",
      request: { params: orgIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: orgMemoryResponseSchema } },
          description: "Live org memory",
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
      summary: "Get live org memory",
      tags: ["Organizations"],
    })
  );

  app.get("/v1/orgs/:orgId/memory", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const content = await service.getMemory(orgId);
    return json<OrgMemoryResponse>({ content });
  });

  // PUT /v1/orgs/{orgId}/memory — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      operationId: "updateOrgMemory",
      path: "/v1/orgs/{orgId}/memory",
      request: {
        body: {
          content: { "application/json": { schema: updateOrgMemorySchema } },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: orgMemoryResponseSchema } },
          description: "Memory updated",
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
      summary: "Replace live org memory content",
      tags: ["Organizations"],
    })
  );

  app.put("/v1/orgs/:orgId/memory", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<UpdateOrgMemoryRequest>(c.req.raw);
    await service.setMemory(orgId, body.content, {
      action: "edit",
      actorUserId: auth.user.id,
      label: "Manual edit",
    });
    const content = await service.getMemory(orgId);
    return json<OrgMemoryResponse>({ content });
  });

  // POST /v1/orgs/{orgId}/memory/facts — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "addOrgMemoryFact",
      path: "/v1/orgs/{orgId}/memory/facts",
      request: {
        body: {
          content: { "application/json": { schema: addOrgMemoryFactSchema } },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: orgMemoryResponseSchema } },
          description: "Fact added",
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
      summary: "Add an org memory fact (admin direct, bypass queue)",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/memory/facts", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<AddOrgMemoryFactRequest>(c.req.raw);
    await service.addFact(orgId, body.bullet, {
      change: {
        action: "add_fact",
        actorUserId: auth.user.id,
        label: `Added fact: ${body.bullet.trim()}`,
      },
      pin: body.pin ?? true,
    });
    const content = await service.getMemory(orgId);
    return json<OrgMemoryResponse>({ content });
  });

  // POST /v1/orgs/{orgId}/memory/search — admin + member
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "searchOrgMemory",
      path: "/v1/orgs/{orgId}/memory/search",
      request: {
        body: {
          content: { "application/json": { schema: orgMemorySearchSchema } },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: orgMemorySearchResponseSchema },
          },
          description: "Search results",
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
      summary: "Search org memory (live + archive)",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/memory/search", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<OrgMemorySearchRequest>(c.req.raw);
    const result = await service.search(orgId, body.query);
    return json<OrgMemorySearchResponse>(result);
  });

  // POST /v1/orgs/{orgId}/memory/pin — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "pinOrgMemoryFact",
      path: "/v1/orgs/{orgId}/memory/pin",
      request: {
        body: {
          content: { "application/json": { schema: pinOrgMemorySchema } },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: orgMemoryResponseSchema } },
          description: "Pinned",
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
      summary: "Pin an org memory bullet",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/memory/pin", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<PinOrgMemoryRequest>(c.req.raw);
    await service.pinFact(orgId, body.bullet, {
      action: "pin",
      actorUserId: auth.user.id,
      label: `Pinned fact: ${body.bullet.trim()}`,
    });
    const content = await service.getMemory(orgId);
    return json<OrgMemoryResponse>({ content });
  });

  // POST /v1/orgs/{orgId}/memory/unpin — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "unpinOrgMemoryFact",
      path: "/v1/orgs/{orgId}/memory/unpin",
      request: {
        body: {
          content: { "application/json": { schema: unpinOrgMemorySchema } },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: orgMemoryResponseSchema } },
          description: "Unpinned",
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
      summary: "Unpin an org memory bullet",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/memory/unpin", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<UnpinOrgMemoryRequest>(c.req.raw);
    await service.unpinFact(orgId, body.bullet, {
      action: "unpin",
      actorUserId: auth.user.id,
      label: `Unpinned fact: ${body.bullet.trim()}`,
    });
    const content = await service.getMemory(orgId);
    return json<OrgMemoryResponse>({ content });
  });

  // POST /v1/orgs/{orgId}/memory/archive — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "archiveOrgMemory",
      path: "/v1/orgs/{orgId}/memory/archive",
      request: {
        body: {
          content: { "application/json": { schema: archiveOrgMemorySchema } },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: archiveOrgMemoryResponseSchema },
          },
          description: "Archived",
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
      summary: "Archive org memory bullets",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/memory/archive", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<ArchiveOrgMemoryRequest>(c.req.raw);
    const result = await service.archiveEntries(orgId, body.entries, {
      change: {
        action: "archive",
        actorUserId: auth.user.id,
        label: `Archived ${body.entries.length} ${body.entries.length === 1 ? "fact" : "facts"}`,
      },
      reason: body.reason,
    });
    return json<ArchiveOrgMemoryResponse>(result);
  });

  const listOrgMemoryHistoryResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ListOrgMemoryHistoryResponse");
  const orgMemoryHistoryRevisionResponseSchema = z
    .object({})
    .passthrough()
    .openapi("OrgMemoryHistoryRevisionResponse");
  const restoreOrgMemoryHistoryResponseSchema = z
    .object({})
    .passthrough()
    .openapi("RestoreOrgMemoryHistoryResponse");

  // GET /v1/orgs/{orgId}/memory/history — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listOrgMemoryHistory",
      path: "/v1/orgs/{orgId}/memory/history",
      request: { params: orgIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: listOrgMemoryHistoryResponseSchema },
          },
          description: "Change history",
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
      summary: "List org memory change history",
      tags: ["Organizations"],
    })
  );

  app.get("/v1/orgs/:orgId/memory/history", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const changes = await service.listHistory(orgId);
    return json({ changes });
  });

  // GET /v1/orgs/{orgId}/memory/history/{revisionId} — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getOrgMemoryHistoryRevision",
      path: "/v1/orgs/{orgId}/memory/history/{revisionId}",
      request: {
        params: orgIdParam.extend({
          revisionId: z
            .string()
            .openapi({ param: { in: "path", name: "revisionId" } }),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: orgMemoryHistoryRevisionResponseSchema,
            },
          },
          description: "History revision",
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
      summary: "Get an org memory history revision",
      tags: ["Organizations"],
    })
  );

  app.get("/v1/orgs/:orgId/memory/history/:revisionId", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const revisionId = decodeURIComponent(c.req.param("revisionId"));
    const service = requireService();
    const revision = await service.getHistoryRevision(orgId, revisionId);
    return json(revision);
  });

  // POST /v1/orgs/{orgId}/memory/history/undo — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "undoOrgMemoryChange",
      path: "/v1/orgs/{orgId}/memory/history/undo",
      request: { params: orgIdParam },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: restoreOrgMemoryHistoryResponseSchema,
            },
          },
          description: "Restored previous revision",
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
      summary: "Undo the latest org memory change",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/memory/history/undo", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const content = await service.undoLastChange(orgId, auth.user.id);
    return json({ content });
  });

  // POST /v1/orgs/{orgId}/memory/history/{revisionId}/restore — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "restoreOrgMemoryHistory",
      path: "/v1/orgs/{orgId}/memory/history/{revisionId}/restore",
      request: {
        params: orgIdParam.extend({
          revisionId: z
            .string()
            .openapi({ param: { in: "path", name: "revisionId" } }),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: restoreOrgMemoryHistoryResponseSchema,
            },
          },
          description: "Restored revision",
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
      summary: "Restore org memory to a previous revision",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/memory/history/:revisionId/restore", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const revisionId = decodeURIComponent(c.req.param("revisionId"));
    const service = requireService();
    const content = await service.restoreHistoryRevision(
      orgId,
      revisionId,
      auth.user.id
    );
    return json({ content });
  });

  const listOrgMemoryProposalsResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ListOrgMemoryProposalsResponse");
  const approveOrgMemoryProposalSchema = z
    .object({ pin: z.boolean().optional() })
    .openapi("ApproveOrgMemoryProposalRequest");
  const orgMemoryProposalResponseSchema = z
    .object({})
    .passthrough()
    .openapi("OrgMemoryProposalResponse");

  // GET /v1/orgs/{orgId}/memory/proposals — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listOrgMemoryProposals",
      path: "/v1/orgs/{orgId}/memory/proposals",
      request: {
        params: orgIdParam,
        query: z.object({
          status: z.enum(["pending", "approved", "rejected"]).optional(),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: listOrgMemoryProposalsResponseSchema,
            },
          },
          description: "Proposals",
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
      summary: "List org memory proposals",
      tags: ["Organizations"],
    })
  );

  app.get("/v1/orgs/:orgId/memory/proposals", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const status = c.req.query("status") as
      | "pending"
      | "approved"
      | "rejected"
      | undefined;
    const proposals = await service.listProposals(orgId, status);
    const pendingCount = await service.countPendingProposals(orgId);
    return json({ pendingCount, proposals });
  });

  // POST /v1/orgs/{orgId}/memory/proposals/{proposalId}/approve — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "approveOrgMemoryProposal",
      path: "/v1/orgs/{orgId}/memory/proposals/{proposalId}/approve",
      request: {
        body: {
          content: {
            "application/json": { schema: approveOrgMemoryProposalSchema },
          },
          required: false,
        },
        params: orgIdParam.extend({
          proposalId: z
            .string()
            .openapi({ param: { in: "path", name: "proposalId" } }),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: orgMemoryProposalResponseSchema },
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
      summary: "Approve an org memory proposal",
      tags: ["Organizations"],
    })
  );

  app.post(
    "/v1/orgs/:orgId/memory/proposals/:proposalId/approve",
    async (c) => {
      const auth = requireOrgAdminFromContext(c);
      const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
      const proposalId = decodeURIComponent(c.req.param("proposalId"));
      const service = requireService();
      const body = await readJson<{ pin?: boolean }>(c.req.raw).catch(
        () => ({})
      );
      const proposal = await service.approveProposal(
        orgId,
        proposalId,
        auth.user.id,
        {
          pin: body.pin,
        }
      );
      const content = await service.getMemory(orgId);
      return json({ content, proposal });
    }
  );

  // POST /v1/orgs/{orgId}/memory/proposals/{proposalId}/reject — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "rejectOrgMemoryProposal",
      path: "/v1/orgs/{orgId}/memory/proposals/{proposalId}/reject",
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
            "application/json": { schema: orgMemoryProposalResponseSchema },
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
      summary: "Reject an org memory proposal",
      tags: ["Organizations"],
    })
  );

  app.post("/v1/orgs/:orgId/memory/proposals/:proposalId/reject", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const proposalId = decodeURIComponent(c.req.param("proposalId"));
    const service = requireService();
    const proposal = await service.rejectProposal(
      orgId,
      proposalId,
      auth.user.id
    );
    return json({ proposal });
  });
}
