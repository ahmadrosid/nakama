import { createRoute, z } from "@hono/zod-openapi";
import type {
  DataImportPreviewResponse,
  PreviewDataImportRequest,
  RestoreDataImportRequest,
  RestoreDataImportResponse,
} from "@nakama/core";
import {
  createNakamaDataExport,
  decodeArchiveRequestData,
  previewNakamaDataImport,
  restoreNakamaDataImport,
} from "../../services/data-portability";
import type { ServerOptions } from "../context";
import { requirePlatformAdminFromContext } from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerDataPortabilityRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const importRequestSchema = z
    .object({
      data: z.string(),
    })
    .openapi("PreviewDataImportRequest");
  const restoreRequestSchema = z
    .object({
      confirm: z.boolean(),
      data: z.string(),
    })
    .openapi("RestoreDataImportRequest");
  const previewResponseSchema = z
    .object({})
    .passthrough()
    .openapi("DataImportPreviewResponse");
  const restoreResponseSchema = z
    .object({})
    .passthrough()
    .openapi("RestoreDataImportResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "exportPlatformData",
      path: "/v1/platform/data/export",
      responses: {
        200: {
          content: {
            "application/zip": {
              schema: z.string().openapi({ format: "binary", type: "string" }),
            },
          },
          description: "Nakama data export ZIP",
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
      summary: "Export Nakama data",
      tags: ["Platform"],
    })
  );

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "previewPlatformDataImport",
      path: "/v1/platform/data/import/preview",
      request: {
        body: {
          content: { "application/json": { schema: importRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: previewResponseSchema } },
          description: "Import preview",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        413: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Preview Nakama data import",
      tags: ["Platform"],
    })
  );

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "restorePlatformDataImport",
      path: "/v1/platform/data/import/restore",
      request: {
        body: {
          content: { "application/json": { schema: restoreRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: restoreResponseSchema } },
          description: "Import restored",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        413: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Restore Nakama data import",
      tags: ["Platform"],
    })
  );

  app.get("/v1/platform/data/export", async (c) => {
    requirePlatformAdminFromContext(c);
    const result = await createNakamaDataExport();
    return new Response(result.data, {
      headers: {
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Type": "application/zip",
      },
    });
  });

  app.post("/v1/platform/data/import/preview", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<PreviewDataImportRequest>(c.req.raw);
    // Decoded outside the catch so an oversized archive keeps its 413.
    const archive = decodeArchiveRequestData(body.data);

    try {
      const preview = await previewNakamaDataImport(archive);
      return json<DataImportPreviewResponse>(preview);
    } catch (error) {
      return errorResponse(formatImportError(error), 400);
    }
  });

  app.post("/v1/platform/data/import/restore", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<RestoreDataImportRequest>(c.req.raw);
    const archive = decodeArchiveRequestData(body.data);

    let restore;
    try {
      restore = await restoreNakamaDataImport(archive, {
        confirm: body.confirm,
      });
    } catch (error) {
      return errorResponse(formatImportError(error), 400);
    }

    if (options.onDataRestored) {
      try {
        await options.onDataRestored();
      } catch {
        // Disk restore already committed; caller must restart to finish reload.
      }
    }

    return json<RestoreDataImportResponse>(restore);
  });
}

function formatImportError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
