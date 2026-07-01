import { createRoute, z } from "@hono/zod-openapi";
import {
  type DataFolderMigrationResponse,
  type DataImportPreviewResponse,
  type PreviewDataImportRequest,
  type RestoreDataImportRequest,
  type RestoreDataImportResponse,
} from "@tinyclaw/core";
import {
  createTinyClawDataExport,
  previewTinyClawDataImport,
  restoreTinyClawDataImport,
} from "../../services/data-portability";
import { runDataFolderMigration } from "../../services/data-folder-migration";
import { errorResponse, json, readJson } from "../shared";
import { requirePlatformAdminFromContext } from "../org-guards";
import type { ServerOptions } from "../context";
import type { HonoApp } from "../types";

export function registerDataPortabilityRoutes(app: HonoApp, _options: ServerOptions): void {
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
  const migrationResponseSchema = z.object({}).passthrough().openapi("DataFolderMigrationResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/platform/data/export",
      tags: ["Platform"],
      summary: "Export Tinyclaw data",
      operationId: "exportPlatformData",
      responses: {
        200: {
          description: "Tinyclaw data export ZIP",
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
      summary: "Preview Tinyclaw data import",
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
      path: "/v1/platform/data/migrate-folders",
      tags: ["Platform"],
      summary: "Migrate legacy profile data folders",
      operationId: "migratePlatformDataFolders",
      responses: {
        200: {
          description: "Migration completed",
          content: { "application/json": { schema: migrationResponseSchema } },
        },
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
      summary: "Restore Tinyclaw data import",
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
    const result = await createTinyClawDataExport();
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
      const preview = await previewTinyClawDataImport(readArchiveRequestData(body.data));
      return json<DataImportPreviewResponse>(preview);
    } catch (error) {
      return errorResponse(formatImportError(error), 400);
    }
  });

  app.post("/v1/platform/data/migrate-folders", async (c) => {
    requirePlatformAdminFromContext(c);

    try {
      const result = await runDataFolderMigration();
      return json<DataFolderMigrationResponse>(result);
    } catch (error) {
      return errorResponse(formatImportError(error), 500);
    }
  });

  app.post("/v1/platform/data/import/restore", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<RestoreDataImportRequest>(c.req.raw);

    try {
      const restore = await restoreTinyClawDataImport(readArchiveRequestData(body.data), {
        confirm: body.confirm,
      });
      return json<RestoreDataImportResponse>(restore);
    } catch (error) {
      return errorResponse(formatImportError(error), 400);
    }
  });
}

function readArchiveRequestData(data: string): Buffer {
  const trimmed = data.trim();
  if (!trimmed) {
    throw new Error("Import archive data is required.");
  }

  return Buffer.from(trimmed, "base64");
}

function formatImportError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
