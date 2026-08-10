import { createRoute, z } from "@hono/zod-openapi";
import { NakamaApiError } from "@nakama/core";
import type {
  ApplySkillSuggestionResponse,
  ListSkillSuggestionsResponse,
} from "@nakama/core/contract";
import {
  type SkillSuggestionService,
  toSkillSuggestion,
} from "../../services/skill-suggestion-service";
import type { ServerOptions } from "../context";
import { requireNotViewerFromContext } from "../org-guards";
import { json } from "../shared";
import type { HonoApp } from "../types";

export function registerSkillSuggestionRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const skillSuggestionService = options.skillSuggestionService;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const orgIdParam = z.object({
    orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
  });
  const listSkillSuggestionsResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ListSkillSuggestionsResponse");
  const applySkillSuggestionResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ApplySkillSuggestionResponse");

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

  function requireService(): SkillSuggestionService {
    if (!skillSuggestionService) {
      throw new NakamaApiError("Skill suggestion service not configured", 500);
    }
    return skillSuggestionService;
  }

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listSkillSuggestions",
      path: "/v1/orgs/{orgId}/skill-suggestions",
      request: {
        params: orgIdParam,
        query: z.object({
          profileId: z.string().optional(),
          sessionId: z.string().optional(),
          status: z.enum(["pending", "applied"]).optional(),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: listSkillSuggestionsResponseSchema },
          },
          description: "Skill suggestions",
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
      summary: "List post-turn skill suggestions",
      tags: ["Organizations"],
    })
  );

  app.get("/v1/orgs/:orgId/skill-suggestions", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
    const service = requireService();
    const sessionId = c.req.query("sessionId");
    const status = c.req.query("status") as "pending" | "applied" | undefined;
    const profileId = c.req.query("profileId");
    const suggestions = await service.listSuggestions(orgId, {
      profileId: profileId || undefined,
      sessionId: sessionId || undefined,
      status,
    });
    return json<ListSkillSuggestionsResponse>({
      suggestions: suggestions.map(toSkillSuggestion),
    });
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "applySkillSuggestion",
      path: "/v1/orgs/{orgId}/skill-suggestions/{suggestionId}/apply",
      request: {
        params: orgIdParam.extend({
          suggestionId: z
            .string()
            .openapi({ param: { in: "path", name: "suggestionId" } }),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: applySkillSuggestionResponseSchema },
          },
          description: "Applied",
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
      summary: "Apply a pending skill suggestion",
      tags: ["Organizations"],
    })
  );

  app.post(
    "/v1/orgs/:orgId/skill-suggestions/:suggestionId/apply",
    async (c) => {
      const auth = requireNotViewerFromContext(c);
      const orgId = resolveOrgId(c, auth.activeOrgId ?? "");
      const suggestionId = decodeURIComponent(c.req.param("suggestionId"));
      const service = requireService();
      const result = await service.applySuggestion(
        orgId,
        suggestionId,
        auth.user.id
      );
      return json<ApplySkillSuggestionResponse>({
        outcome: result.outcome,
        proposalId: result.proposalId,
        suggestion: toSkillSuggestion(result.suggestion),
      });
    }
  );
}
