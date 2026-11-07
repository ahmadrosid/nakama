import { createRoute, z } from "@hono/zod-openapi";
import {
  type BackupStatusResponse,
  type DataImportPreviewResponse,
  NakamaApiError,
  type PreviewDataImportRequest,
  type RestoreDataImportRequest,
  type RestoreDataImportResponse,
} from "@nakama/core";
import {
  type CreateDataExportFileResult,
  createNakamaDataExportFile,
  createNakamaOrgDataExport,
  createNakamaUserDataExport,
  decodeArchiveRequestData,
  getDataImportLimits,
  type ImportLimits,
  openImportArchive,
  previewNakamaDataImportFile,
  restoreNakamaDataImportFile,
  spoolImportArchive,
  writeTempImportArchive,
} from "../../services/data-portability";
import { runWithPluginExportBarrier } from "../../services/plugin-service";
import { readBackupError } from "../../services/scheduled-backup";
import type { ServerOptions } from "../context";
import { requirePlatformAdminFromContext } from "../org-guards";
import {
  errorResponse,
  isArchiveRequest,
  json,
  MAX_HTTP_REQUEST_BODY_LIMIT_BYTES,
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

export interface ImportRequestArchive {
  cleanup: () => Promise<void>;
  confirm: boolean;
  path: string;
}

/**
 * Reads an import body as a raw ZIP or as the JSON `{ data, confirm }` form.
 * Browsers send the raw ZIP because base64-encoding a large file in a tab takes
 * minutes. A raw body carries `confirm` in the query string.
 */
export async function readImportRequest(
  request: Request,
  readJsonBody: () => Promise<{ confirm?: boolean; data: string }>,
  limits: ImportLimits,
  tooLargeMessage?: string
): Promise<ImportRequestArchive> {
  const archiveRequest = isArchiveRequest(request);
  const declaredLength = Number(request.headers.get("content-length") ?? "");

  // Base64 carries 3 bytes per 4 characters, plus room for JSON wrapping.
  const jsonBodyLimit = Math.ceil(limits.archiveBytes / 3) * 4 + 64 * 1024;

  const bodyLimit = archiveRequest
    ? limits.archiveBytes
    : Math.min(jsonBodyLimit, MAX_HTTP_REQUEST_BODY_LIMIT_BYTES);

  if (Number.isFinite(declaredLength) && declaredLength > bodyLimit) {
    throw new NakamaApiError(
      tooLargeMessage ??
        `Import archive must be at most ${Math.floor(
          limits.archiveBytes / (1024 * 1024)
        )} MB.`,
      413
    );
  }

  if (!archiveRequest) {
    const body = await readJsonBody();

    const temp = await writeTempImportArchive(
      decodeArchiveRequestData(body.data, tooLargeMessage)
    );

    return {
      cleanup: temp.cleanup,
      confirm: body.confirm === true,
      path: temp.path,
    };
  }

  if (!request.body) {
    throw new NakamaApiError("Import archive data is required.", 400);
  }

  const spooled = await readUntilClientGone(
    request,
    spoolImportArchive(request.body, {
      limits,
      signal: request.signal,
      tooLargeMessage,
    })
  );

  try {
    const opened = await openImportArchive(spooled.path);

    return {
      cleanup: async () => {
        await opened.cleanup();
        await spooled.cleanup();
      },
      confirm: new URL(request.url).searchParams.get("confirm") === "true",
      path: opened.path,
    };
  } catch (error) {
    await spooled.cleanup();
    throw error;
  }
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
      method: "get",
      operationId: "getPlatformBackupStatus",
      path: "/v1/platform/data/backup-status",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z
                .object({
                  lastError: z
                    .object({ at: z.string(), message: z.string() })
                    .nullable(),
                })
                .openapi("BackupStatusResponse"),
            },
          },
          description: "The last scheduled backup's 409, or null",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get the scheduled backup status",
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
          createNakamaDataExportFile()
        )
      : await createNakamaDataExportFile();

    return serveExportFile(result);
  });

  app.get("/v1/platform/data/backup-status", async (c) => {
    requirePlatformAdminFromContext(c);
    const dir = process.env.NAKAMA_BACKUP_DIR?.trim();

    return json<BackupStatusResponse>({
      lastError: dir ? await readBackupError(dir) : null,
    });
  });

  app.post("/v1/platform/data/import/preview", async (c) => {
    requirePlatformAdminFromContext(c);

    // Read outside the catch so an oversized archive keeps its 413.
    const archive = await readImportRequest(
      c.req.raw,
      () =>
        readJson<PreviewDataImportRequest>(
          c.req.raw,
          importRequestSchema,
          MAX_HTTP_REQUEST_BODY_LIMIT_BYTES
        ),
      getDataImportLimits()
    );

    try {
      const preview = await previewNakamaDataImportFile(archive.path);

      return json<DataImportPreviewResponse>(preview);
    } catch (error) {
      return errorResponse(formatImportError(error), 400);
    } finally {
      await archive.cleanup();
    }
  });

  app.post("/v1/platform/data/import/restore", async (c) => {
    requirePlatformAdminFromContext(c);

    const archive = await readImportRequest(
      c.req.raw,
      () =>
        readJson<RestoreDataImportRequest>(
          c.req.raw,
          restoreRequestSchema,
          MAX_HTTP_REQUEST_BODY_LIMIT_BYTES
        ),
      getDataImportLimits()
    );

    try {
      let restore;

      try {
        const restoreOperation = () =>
          runWithPluginExportBarrier(async () => {
            const { onBeforeDataRestore } = options;
            let databaseReleased = false;

            const result = await restoreNakamaDataImportFile(archive.path, {
              afterFailedReplace: options.onDataRestored,
              beforeReplace: onBeforeDataRestore
                ? async () => {
                    databaseReleased = true;
                    await onBeforeDataRestore();
                  }
                : undefined,
              confirm: archive.confirm,
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
    } finally {
      await archive.cleanup();
    }
  });
}

function serveExportFile(result: CreateDataExportFileResult): Response {
  const file = Bun.file(result.path);
  const reader = file.stream().getReader();
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) {
      return;
    }

    cleaned = true;
    await result.cleanup();
  };

  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            controller.close();
            await cleanup();

            return;
          }

          controller.enqueue(value);
        } catch (error) {
          await cleanup();
          controller.error(error);
        }
      },
      async cancel() {
        try {
          await reader.cancel();
        } finally {
          await cleanup();
        }
      },
    }),
    {
      headers: {
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Length": String(file.size),
        "Content-Type": "application/zip",
      },
    }
  );
}

function formatImportError<T>(error: T): string {
  return error instanceof Error ? error.message : String(error);
}
