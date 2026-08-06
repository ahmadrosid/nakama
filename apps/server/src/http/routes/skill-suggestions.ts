import { createRoute, z } from "@hono/zod-openapi";
import { NakamaApiError } from "@nakama/core";
import type {
  ApplySkillSuggestionResponse,
  ListSkillSuggestionsResponse,
} from "@nakama/core/contract";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";
import { json } from "../shared";
import { requireNotViewerFromContext } from "../org-guards";
import { SkillSuggestionService, toSkillSuggestion } from "../../services/skill-suggestion-service";

export function registerSkillSuggestionRoutes(app: HonoApp, options: ServerOptions): void {
  const skillSuggestionService = options.skillSuggestionService;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const orgIdParam = z.object({
    orgId: z.string().openapi({ param: { name: "orgId", in: "path" } }),
  });
  const listSkillSuggestionsResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ListSkillSuggestionsResponse");
  const applySkillSuggestionResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ApplySkillSuggestionResponse");

  function resolveOrgId(c: { req: { param: (n: string) => string } }, authOrgId: string): string {
    const orgId = decodeURIComponent(c.req.param("orgId"));
    if (authOrgId !== orgId) {
      throw new NakamaApiError("Not found", 404);
    }
    return orgId;
  }

  function requireService(): SkillSuggestionService {
    if (!skillSuggestionService) {
      throw new NakamaApiError("Skill suggestion service not configured", 500);
    }
    return skillSuggestionService;
  }

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/orgs/{orgId}/skill-suggestions",
      tags: ["Organizations"],
      summary: "List post-turn skill suggestions",
      operationId: "listSkillSuggestions",
      request: {
        params: orgIdParam,
        query: z.object({
          sessionId: z.string().optional(),
          status: z.enum(["pending", "applied"]).optional(),
          profileId: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: "Skill suggestions",
          content: { "application/json": { schema: listSkillSuggestionsResponseSchema } },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.get("/v1/orgs/:orgId/skill-suggestions", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const sessionId = c.req.query("sessionId");
    const status = c.req.query("status") as "pending" | "applied" | undefined;
    const profileId = c.req.query("profileId");
    const suggestions = await service.listSuggestions(orgId, {
      sessionId: sessionId || undefined,
      status,
      profileId: profileId || undefined,
    });
    return json<ListSkillSuggestionsResponse>({
      suggestions: suggestions.map(toSkillSuggestion),
    });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/orgs/{orgId}/skill-suggestions/{suggestionId}/apply",
      tags: ["Organizations"],
      summary: "Apply a pending skill suggestion",
      operationId: "applySkillSuggestion",
      request: {
        params: orgIdParam.extend({
          suggestionId: z.string().openapi({ param: { name: "suggestionId", in: "path" } }),
        }),
      },
      responses: {
        200: {
          description: "Applied",
          content: { "application/json": { schema: applySkillSuggestionResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/orgs/:orgId/skill-suggestions/:suggestionId/apply", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const suggestionId = decodeURIComponent(c.req.param("suggestionId"));
    const service = requireService();
    const result = await service.applySuggestion(orgId, suggestionId, auth.user.id);
    return json<ApplySkillSuggestionResponse>({
      outcome: result.outcome,
      suggestion: toSkillSuggestion(result.suggestion),
      proposalId: result.proposalId,
    });
  });
}
