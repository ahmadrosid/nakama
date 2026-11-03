import { createRoute, z } from "@hono/zod-openapi";
import type {
  DataImportPreviewResponse,
  PreviewDataImportRequest,
  RestoreDataImportRequest,
  RestoreDataImportResponse,
} from "@nakama/core";
import {
  createNakamaDataExport,
  createNakamaOrgDataExport,
  createNakamaUserDataExport,
  decodeArchiveRequestBytes,
  decodeArchiveRequestData,
  previewNakamaDataImport,
  restoreNakamaDataImport,
} from "../../services/data-portability";
import { runWithPluginExportBarrier } from "../../services/plugin-service";
import type { ServerOptions } from "../context";
import { requirePlatformAdminFromContext } from "../org-guards";
import {
  errorResponse,
  isArchiveRequest,
  json,
  readJson,
  readUntilClientGone,
} from "../shared";
import type { HonoApp } from "../types";

/** A raw ZIP body, the form browsers send. */
export const importArchiveBodySchema = z.string().openapi({ format: "binary" });

/** Only read for an application/zip body; JSON carries `confirm` itself. */
export const importConfirmQuerySchema = z.object({
  confirm: z.enum(["true"]).optional(),
});

/**
 * Reads an import body as a raw ZIP or as the JSON `{ data, confirm }` form.
 * Browsers send the raw ZIP because base64-encoding a large file in a tab takes
 * minutes. A raw body carries `confirm` in the query string.
 */
export async function readImportRequest(
  request: Request,
  readJsonBody: () => Promise<{ confirm?: boolean; data: string }>,
  tooLargeMessage?: string
): Promise<{ archive: Buffer; confirm: boolean }> {
  if (!isArchiveRequest(request)) {
    const body = await readJsonBody();

    return {
      archive: decodeArchiveRequestData(body.data, tooLargeMessage),
      confirm: body.confirm === true,
    };
  }

  const bytes = await readUntilClientGone(request, request.arrayBuffer());

  return {
    archive: decodeArchiveRequestBytes(Buffer.from(bytes), tooLargeMessage),
    confirm: new URL(request.url).searchParams.get("confirm") === "true",
  };
}

export function registerDataPortabilityRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const databaseAdapter = options.databaseAdapter;

  if (!databaseAdapter) {
    return;
  }

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
      operationId: "exportPlatformOrganizationData",
      path: "/v1/platform/orgs/{orgId}/data/export",
      request: {
        params: z.object({
          orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
        }),
      },
      responses: {
        200: {
          content: {
            "application/zip": {
              schema: z.string().openapi({ format: "binary", type: "string" }),
            },
          },
          description: "Organization data export ZIP",
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
      summary: "Export one organization's portable data",
      tags: ["Platform"],
    })
  );

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "exportPlatformUserData",
      path: "/v1/platform/users/{userId}/data/export",
      request: {
        params: z.object({
          userId: z.string().openapi({ param: { in: "path", name: "userId" } }),
        }),
      },
      responses: {
        200: {
          content: {
            "application/zip": {
              schema: z.string().openapi({ format: "binary", type: "string" }),
            },
          },
          description: "User data export ZIP",
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
      summary: "Export one user's portable data",
      tags: ["Platform"],
    })
  );

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
          content: {
            "application/json": { schema: importRequestSchema },
            "application/zip": { schema: importArchiveBodySchema },
          },
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
          content: {
            "application/json": { schema: restoreRequestSchema },
            "application/zip": { schema: importArchiveBodySchema },
          },
          required: true,
        },
        query: importConfirmQuerySchema,
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

  app.get("/v1/platform/orgs/:orgId/data/export", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = decodeURIComponent(c.req.param("orgId"));

    const result = await createNakamaOrgDataExport(databaseAdapter, orgId);

    return new Response(new Uint8Array(result.data), {
      headers: {
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Type": "application/zip",
      },
    });
  });

  app.get("/v1/platform/users/:userId/data/export", async (c) => {
    requirePlatformAdminFromContext(c);
    const userId = decodeURIComponent(c.req.param("userId"));

    const result = await createNakamaUserDataExport(databaseAdapter, userId);

    return new Response(new Uint8Array(result.data), {
      headers: {
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Type": "application/zip",
      },
    });
  });

  app.get("/v1/platform/data/export", async (c) => {
    requirePlatformAdminFromContext(c);

    const result = options.googleMeetService
      ? await options.googleMeetService.withSnapshot(() =>
          createNakamaDataExport()
        )
      : await createNakamaDataExport();

    return new Response(new Uint8Array(result.data), {
      headers: {
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Type": "application/zip",
      },
    });
  });

  app.post("/v1/platform/data/import/preview", async (c) => {
    requirePlatformAdminFromContext(c);

    // Read outside the catch so an oversized archive keeps its 413.
    const { archive } = await readImportRequest(c.req.raw, () =>
      readJson<PreviewDataImportRequest>(c.req.raw, importRequestSchema)
    );

    try {
      const preview = await previewNakamaDataImport(archive);

      return json<DataImportPreviewResponse>(preview);
    } catch (error) {
      return errorResponse(formatImportError(error), 400);
    }
  });

  app.post("/v1/platform/data/import/restore", async (c) => {
    requirePlatformAdminFromContext(c);

    const { archive, confirm } = await readImportRequest(c.req.raw, () =>
      readJson<RestoreDataImportRequest>(c.req.raw, restoreRequestSchema)
    );

    let restore;

    try {
      const restoreOperation = () =>
        runWithPluginExportBarrier(async () => {
          const { onBeforeDataRestore } = options;
          let databaseReleased = false;

          const result = await restoreNakamaDataImport(archive, {
            afterFailedReplace: options.onDataRestored,
            beforeReplace: onBeforeDataRestore
              ? async () => {
                  databaseReleased = true;
                  await onBeforeDataRestore();
                }
              : undefined,
            confirm,
          });

          // Drop registrations before reloading restored data; restored plugins stay disabled.
          try {
            await options.workerManager.clearPluginWorkers?.();
          } catch (error) {
            // The restore committed with the database released; reopen it before failing.
            if (databaseReleased) {
              await options.onDataRestored?.().catch(() => undefined);
            }

            throw error;
          }

          await options.onDataRestored?.();

          return result;
        });

      restore = options.googleMeetService
        ? await options.googleMeetService.withSnapshot(restoreOperation)
        : await restoreOperation();
    } catch (error) {
      return errorResponse(formatImportError(error), 400);
    }

    return json<RestoreDataImportResponse>(restore);
  });
}

function formatImportError<T>(error: T): string {
  return error instanceof Error ? error.message : String(error);
}
