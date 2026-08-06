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
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";
import { json, readJson } from "../shared";
import { requireOrgAdminFromContext, requireNotViewerFromContext } from "../org-guards";

export function registerOrgMemoryRoutes(app: HonoApp, options: ServerOptions): void {
  const orgMemoryService = options.orgMemoryService;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const orgIdParam = z.object({
    orgId: z.string().openapi({ param: { name: "orgId", in: "path" } }),
  });
  const orgMemoryResponseSchema = z.object({}).passthrough().openapi("OrgMemoryResponse");
  const updateOrgMemorySchema = z
    .object({ content: z.string() })
    .openapi("UpdateOrgMemoryRequest");
  const addOrgMemoryFactSchema = z
    .object({ bullet: z.string(), pin: z.boolean().optional() })
    .openapi("AddOrgMemoryFactRequest");
  const orgMemorySearchSchema = z.object({ query: z.string() }).openapi("OrgMemorySearchRequest");
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
  const pinOrgMemorySchema = z.object({ bullet: z.string() }).openapi("PinOrgMemoryRequest");
  const unpinOrgMemorySchema = z.object({ bullet: z.string() }).openapi("UnpinOrgMemoryRequest");

  function resolveOrgId(c: { req: { param: (n: string) => string } }, authOrgId: string): string {
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
      path: "/v1/orgs/{orgId}/memory",
      tags: ["Organizations"],
      summary: "Get live org memory",
      operationId: "getOrgMemory",
      request: { params: orgIdParam },
      responses: {
        200: {
          description: "Live org memory",
          content: { "application/json": { schema: orgMemoryResponseSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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
      path: "/v1/orgs/{orgId}/memory",
      tags: ["Organizations"],
      summary: "Replace live org memory content",
      operationId: "updateOrgMemory",
      request: {
        params: orgIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: updateOrgMemorySchema } },
        },
      },
      responses: {
        200: {
          description: "Memory updated",
          content: { "application/json": { schema: orgMemoryResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.put("/v1/orgs/:orgId/memory", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<UpdateOrgMemoryRequest>(c.req.raw);
    await service.setMemory(orgId, body.content, {
      actorUserId: auth.user.id,
      action: "edit",
      label: "Manual edit",
    });
    const content = await service.getMemory(orgId);
    return json<OrgMemoryResponse>({ content });
  });

  // POST /v1/orgs/{orgId}/memory/facts — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/memory/facts",
      tags: ["Organizations"],
      summary: "Add an org memory fact (admin direct, bypass queue)",
      operationId: "addOrgMemoryFact",
      request: {
        params: orgIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: addOrgMemoryFactSchema } },
        },
      },
      responses: {
        200: {
          description: "Fact added",
          content: { "application/json": { schema: orgMemoryResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/orgs/:orgId/memory/facts", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<AddOrgMemoryFactRequest>(c.req.raw);
    await service.addFact(orgId, body.bullet, {
      pin: body.pin ?? true,
      change: {
        actorUserId: auth.user.id,
        action: "add_fact",
        label: `Added fact: ${body.bullet.trim()}`,
      },
    });
    const content = await service.getMemory(orgId);
    return json<OrgMemoryResponse>({ content });
  });

  // POST /v1/orgs/{orgId}/memory/search — admin + member
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/memory/search",
      tags: ["Organizations"],
      summary: "Search org memory (live + archive)",
      operationId: "searchOrgMemory",
      request: {
        params: orgIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: orgMemorySearchSchema } },
        },
      },
      responses: {
        200: {
          description: "Search results",
          content: { "application/json": { schema: orgMemorySearchResponseSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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
      path: "/v1/orgs/{orgId}/memory/pin",
      tags: ["Organizations"],
      summary: "Pin an org memory bullet",
      operationId: "pinOrgMemoryFact",
      request: {
        params: orgIdParam,
        body: { required: true, content: { "application/json": { schema: pinOrgMemorySchema } } },
      },
      responses: {
        200: {
          description: "Pinned",
          content: { "application/json": { schema: orgMemoryResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/orgs/:orgId/memory/pin", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<PinOrgMemoryRequest>(c.req.raw);
    await service.pinFact(orgId, body.bullet, {
      actorUserId: auth.user.id,
      action: "pin",
      label: `Pinned fact: ${body.bullet.trim()}`,
    });
    const content = await service.getMemory(orgId);
    return json<OrgMemoryResponse>({ content });
  });

  // POST /v1/orgs/{orgId}/memory/unpin — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/memory/unpin",
      tags: ["Organizations"],
      summary: "Unpin an org memory bullet",
      operationId: "unpinOrgMemoryFact",
      request: {
        params: orgIdParam,
        body: { required: true, content: { "application/json": { schema: unpinOrgMemorySchema } } },
      },
      responses: {
        200: {
          description: "Unpinned",
          content: { "application/json": { schema: orgMemoryResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/orgs/:orgId/memory/unpin", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<UnpinOrgMemoryRequest>(c.req.raw);
    await service.unpinFact(orgId, body.bullet, {
      actorUserId: auth.user.id,
      action: "unpin",
      label: `Unpinned fact: ${body.bullet.trim()}`,
    });
    const content = await service.getMemory(orgId);
    return json<OrgMemoryResponse>({ content });
  });

  // POST /v1/orgs/{orgId}/memory/archive — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/memory/archive",
      tags: ["Organizations"],
      summary: "Archive org memory bullets",
      operationId: "archiveOrgMemory",
      request: {
        params: orgIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: archiveOrgMemorySchema } },
        },
      },
      responses: {
        200: {
          description: "Archived",
          content: { "application/json": { schema: archiveOrgMemoryResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/orgs/:orgId/memory/archive", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const body = await readJson<ArchiveOrgMemoryRequest>(c.req.raw);
    const result = await service.archiveEntries(orgId, body.entries, {
      reason: body.reason,
      change: {
        actorUserId: auth.user.id,
        action: "archive",
        label: `Archived ${body.entries.length} ${body.entries.length === 1 ? "fact" : "facts"}`,
      },
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
      path: "/v1/orgs/{orgId}/memory/history",
      tags: ["Organizations"],
      summary: "List org memory change history",
      operationId: "listOrgMemoryHistory",
      request: { params: orgIdParam },
      responses: {
        200: {
          description: "Change history",
          content: { "application/json": { schema: listOrgMemoryHistoryResponseSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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
      path: "/v1/orgs/{orgId}/memory/history/{revisionId}",
      tags: ["Organizations"],
      summary: "Get an org memory history revision",
      operationId: "getOrgMemoryHistoryRevision",
      request: {
        params: orgIdParam.extend({
          revisionId: z.string().openapi({ param: { name: "revisionId", in: "path" } }),
        }),
      },
      responses: {
        200: {
          description: "History revision",
          content: { "application/json": { schema: orgMemoryHistoryRevisionResponseSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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
      path: "/v1/orgs/{orgId}/memory/history/undo",
      tags: ["Organizations"],
      summary: "Undo the latest org memory change",
      operationId: "undoOrgMemoryChange",
      request: { params: orgIdParam },
      responses: {
        200: {
          description: "Restored previous revision",
          content: { "application/json": { schema: restoreOrgMemoryHistoryResponseSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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
      path: "/v1/orgs/{orgId}/memory/history/{revisionId}/restore",
      tags: ["Organizations"],
      summary: "Restore org memory to a previous revision",
      operationId: "restoreOrgMemoryHistory",
      request: {
        params: orgIdParam.extend({
          revisionId: z.string().openapi({ param: { name: "revisionId", in: "path" } }),
        }),
      },
      responses: {
        200: {
          description: "Restored revision",
          content: { "application/json": { schema: restoreOrgMemoryHistoryResponseSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/orgs/:orgId/memory/history/:revisionId/restore", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const revisionId = decodeURIComponent(c.req.param("revisionId"));
    const service = requireService();
    const content = await service.restoreHistoryRevision(orgId, revisionId, auth.user.id);
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
      path: "/v1/orgs/{orgId}/memory/proposals",
      tags: ["Organizations"],
      summary: "List org memory proposals",
      operationId: "listOrgMemoryProposals",
      request: {
        params: orgIdParam,
        query: z.object({
          status: z.enum(["pending", "approved", "rejected"]).optional(),
        }),
      },
      responses: {
        200: {
          description: "Proposals",
          content: { "application/json": { schema: listOrgMemoryProposalsResponseSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.get("/v1/orgs/:orgId/memory/proposals", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const status = c.req.query("status") as "pending" | "approved" | "rejected" | undefined;
    const proposals = await service.listProposals(orgId, status);
    const pendingCount = await service.countPendingProposals(orgId);
    return json({ proposals, pendingCount });
  });

  // POST /v1/orgs/{orgId}/memory/proposals/{proposalId}/approve — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/memory/proposals/{proposalId}/approve",
      tags: ["Organizations"],
      summary: "Approve an org memory proposal",
      operationId: "approveOrgMemoryProposal",
      request: {
        params: orgIdParam.extend({
          proposalId: z.string().openapi({ param: { name: "proposalId", in: "path" } }),
        }),
        body: {
          required: false,
          content: { "application/json": { schema: approveOrgMemoryProposalSchema } },
        },
      },
      responses: {
        200: {
          description: "Approved",
          content: { "application/json": { schema: orgMemoryProposalResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/orgs/:orgId/memory/proposals/:proposalId/approve", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const proposalId = decodeURIComponent(c.req.param("proposalId"));
    const service = requireService();
    const body = await readJson<{ pin?: boolean }>(c.req.raw).catch(() => ({}));
    const proposal = await service.approveProposal(orgId, proposalId, auth.user.id, {
      pin: body.pin,
    });
    const content = await service.getMemory(orgId);
    return json({ proposal, content });
  });

  // POST /v1/orgs/{orgId}/memory/proposals/{proposalId}/reject — admin only
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/memory/proposals/{proposalId}/reject",
      tags: ["Organizations"],
      summary: "Reject an org memory proposal",
      operationId: "rejectOrgMemoryProposal",
      request: {
        params: orgIdParam.extend({
          proposalId: z.string().openapi({ param: { name: "proposalId", in: "path" } }),
        }),
      },
      responses: {
        200: {
          description: "Rejected",
          content: { "application/json": { schema: orgMemoryProposalResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/orgs/:orgId/memory/proposals/:proposalId/reject", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const proposalId = decodeURIComponent(c.req.param("proposalId"));
    const service = requireService();
    const proposal = await service.rejectProposal(orgId, proposalId, auth.user.id);
    return json({ proposal });
  });
}
