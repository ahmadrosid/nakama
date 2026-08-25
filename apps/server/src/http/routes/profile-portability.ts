import { createRoute, z } from "@hono/zod-openapi";
import type {
  ProfilePackImportRequest,
  ProfilePackImportResponse,
  ProfilePackPreviewResponse,
} from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import { decodeArchiveRequestData } from "../../services/data-portability";
import {
  createProfilePackExport,
  importProfilePack,
  previewProfilePackImport,
} from "../../services/profile-portability";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgAdminOrPlatformAdminFromContext,
} from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerProfilePortabilityRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const importRequestSchema = z
    .object({
      data: z.string(),
      name: z.string().optional(),
    })
    .openapi("PreviewProfilePackImportRequest");
  const restoreRequestSchema = z
    .object({
      confirm: z.boolean(),
      data: z.string(),
      name: z.string().optional(),
    })
    .openapi("ImportProfilePackRequest");
  const previewResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ProfilePackPreviewResponse");
  const importResponseSchema = z
    .object({})
    .passthrough()
    .openapi("ProfilePackImportResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "exportProfilePack",
      path: "/v1/profiles/{profileId}/pack/export",
      request: {
        params: z.object({
          profileId: z.string(),
        }),
      },
      responses: {
        200: {
          content: {
            "application/zip": {
              schema: z.string().openapi({ format: "binary", type: "string" }),
            },
          },
          description: "Profile pack ZIP",
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
      summary: "Export a single profile as a pack ZIP",
      tags: ["Profiles"],
    })
  );

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "previewProfilePackImport",
      path: "/v1/profiles/pack/import/preview",
      request: {
        body: {
          content: { "application/json": { schema: importRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: previewResponseSchema } },
          description: "Profile pack import preview",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Preview a profile pack import",
      tags: ["Profiles"],
    })
  );

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "importProfilePack",
      path: "/v1/profiles/pack/import",
      request: {
        body: {
          content: { "application/json": { schema: restoreRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: importResponseSchema } },
          description: "Profile pack imported",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Import a profile pack as a new profile",
      tags: ["Profiles"],
    })
  );

  app.get("/v1/profiles/:profileId/pack/export", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const db = requireDatabase(options);

    try {
      const result = await createProfilePackExport(db, orgId, profileId);
      return new Response(result.data, {
        headers: {
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "Content-Type": "application/zip",
        },
      });
    } catch (error) {
      return formatPackError(error);
    }
  });

  app.post("/v1/profiles/pack/import/preview", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const db = requireDatabase(options);
    const body = await readJson<{ data: string; name?: string }>(c.req.raw);

    try {
      const preview = await previewProfilePackImport(
        db,
        orgId,
        decodeArchiveRequestData(body.data)
      );
      return json<ProfilePackPreviewResponse>(
        body.name?.trim()
          ? { ...preview, plannedName: body.name.trim() }
          : preview
      );
    } catch (error) {
      return formatPackError(error);
    }
  });

  app.post("/v1/profiles/pack/import", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const db = requireDatabase(options);
    const body = await readJson<ProfilePackImportRequest>(c.req.raw);

    try {
      const imported = await importProfilePack(
        db,
        orgId,
        decodeArchiveRequestData(body.data),
        {
          confirm: body.confirm,
          name: body.name,
        }
      );
      return json<ProfilePackImportResponse>(imported);
    } catch (error) {
      return formatPackError(error);
    }
  });
}

function requireDatabase(options: ServerOptions) {
  if (!options.databaseAdapter) {
    throw new NakamaApiError("Database is not configured.", 500);
  }
  return options.databaseAdapter;
}

function formatPackError(error: unknown): Response {
  if (error instanceof NakamaApiError) {
    return errorResponse(error.message, error.status);
  }
  return errorResponse(
    error instanceof Error ? error.message : String(error),
    400
  );
}
