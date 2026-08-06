import { createRoute, z } from "@hono/zod-openapi";
import {
  type DataImportPreviewResponse,
  type PreviewDataImportRequest,
  type RestoreDataImportRequest,
  type RestoreDataImportResponse,
} from "@nakama/core";
import {
  createNakamaDataExport,
  decodeArchiveRequestData,
  previewNakamaDataImport,
  restoreNakamaDataImport,
} from "../../services/data-portability";
import { errorResponse, json, readJson } from "../shared";
import { requirePlatformAdminFromContext } from "../org-guards";
import type { ServerOptions } from "../context";
import type { HonoApp } from "../types";

export function registerDataPortabilityRoutes(app: HonoApp, options: ServerOptions): void {
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
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
  const previewResponseSchema = z.object({}).passthrough().openapi("DataImportPreviewResponse");
  const restoreResponseSchema = z.object({}).passthrough().openapi("RestoreDataImportResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/platform/data/export",
      tags: ["Platform"],
      summary: "Export Nakama data",
      operationId: "exportPlatformData",
      responses: {
        200: {
          description: "Nakama data export ZIP",
          content: {
            "application/zip": {
              schema: z.string().openapi({ type: "string", format: "binary" }),
            },
          },
        },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/platform/data/import/preview",
      tags: ["Platform"],
      summary: "Preview Nakama data import",
      operationId: "previewPlatformDataImport",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: importRequestSchema } },
        },
      },
      responses: {
        200: {
          description: "Import preview",
          content: { "application/json": { schema: previewResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/platform/data/import/restore",
      tags: ["Platform"],
      summary: "Restore Nakama data import",
      operationId: "restorePlatformDataImport",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: restoreRequestSchema } },
        },
      },
      responses: {
        200: {
          description: "Import restored",
          content: { "application/json": { schema: restoreResponseSchema } },
        },
        400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
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

    try {
      const preview = await previewNakamaDataImport(decodeArchiveRequestData(body.data));
      return json<DataImportPreviewResponse>(preview);
    } catch (error) {
      return errorResponse(formatImportError(error), 400);
    }
  });

  app.post("/v1/platform/data/import/restore", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<RestoreDataImportRequest>(c.req.raw);

    let restore;
    try {
      restore = await restoreNakamaDataImport(decodeArchiveRequestData(body.data), {
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
