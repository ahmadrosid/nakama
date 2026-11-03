import { createRoute, z } from "@hono/zod-openapi";
import {
  type DataImportPreviewResponse,
  formatServerError,
  NakamaApiError,
  type PreviewDataImportRequest,
  type RestoreDataImportRequest,
  type SetupRestoreDataImportResponse,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import {
  MAX_IMPORT_ARCHIVE_BYTES,
  previewNakamaDataImport,
  restoreNakamaDataImport,
} from "../../services/data-portability";
import type { ServerOptions } from "../context";
import {
  assertJsonRequest,
  errorResponse,
  isArchiveRequest,
  json,
  readJson,
} from "../shared";
import type { HonoApp } from "../types";
import {
  importArchiveBodySchema,
  importConfirmQuerySchema,
  readImportRequest,
} from "./data-portability";

// The body limit in app.ts and the archive size check. Settings has the same cap
// (#2257), so the way past it is outside Nakama.
export const SETUP_BACKUP_TOO_LARGE = `This backup is over the ${MAX_IMPORT_ARCHIVE_BYTES / (1024 * 1024)} MB restore limit, which Settings has too. Restore the data folder from a filesystem or volume backup instead.`;

export function registerSetupImportRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { databaseAdapter } = options;

  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");

  const importRequestSchema = z
    .object({
      data: z.string(),
    })
    .openapi("SetupPreviewDataImportRequest");

  const restoreRequestSchema = z
    .object({
      confirm: z.boolean(),
      data: z.string(),
    })
    .openapi("SetupRestoreDataImportRequest");

  const previewResponseSchema = z
    .object({})
    .passthrough()
    .openapi("SetupDataImportPreviewResponse");

  const restoreResponseSchema = z
    .object({})
    .passthrough()
    .openapi("SetupRestoreDataImportResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "previewSetupDataImport",
      path: "/v1/auth/setup/import/preview",
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
        409: {
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
      summary: "Preview Nakama data import during first-time setup",
      tags: ["Auth"],
    })
  );

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "restoreSetupDataImport",
      path: "/v1/auth/setup/import/restore",
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
        409: {
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
      summary: "Restore Nakama data import during first-time setup",
      tags: ["Auth"],
    })
  );

  app.post("/v1/auth/setup/import/preview", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }

    assertImportContentType(c.req.raw);

    await assertSetupImportAllowed(databaseAdapter);

    // Read outside the catch so an oversized archive keeps its 413.
    const { archive } = await readImportRequest(
      c.req.raw,
      () => readJson<PreviewDataImportRequest>(c.req.raw, importRequestSchema),
      SETUP_BACKUP_TOO_LARGE
    );

    try {
      const preview = await previewNakamaDataImport(archive);

      return json<DataImportPreviewResponse>(preview);
    } catch (error) {
      return errorResponse(formatServerError(error), 400);
    }
  });

  app.post("/v1/auth/setup/import/restore", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }

    assertImportContentType(c.req.raw);

    await assertSetupImportAllowed(databaseAdapter);

    const { archive, confirm } = await readImportRequest(
      c.req.raw,
      () => readJson<RestoreDataImportRequest>(c.req.raw, restoreRequestSchema),
      SETUP_BACKUP_TOO_LARGE
    );

    let restore;

    try {
      restore = await restoreNakamaDataImport(archive, {
        afterFailedReplace: options.onDataRestored,
        beforeReplace: options.onBeforeDataRestore,
        confirm,
      });
    } catch (error) {
      return errorResponse(formatServerError(error), 400);
    }

    let requiresRestart = !options.onDataRestored;

    if (options.onDataRestored) {
      try {
        await options.onDataRestored();
        requiresRestart = false;
      } catch {
        requiresRestart = true;
      }
    }

    return json<SetupRestoreDataImportResponse>({
      ...restore,
      requiresRestart,
    });
  });
}

// These routes run before any login, so a cross-site form must not reach them.
function assertImportContentType(request: Request): void {
  if (!isArchiveRequest(request)) {
    assertJsonRequest(request);
  }
}

export async function assertSetupImportAllowed(
  databaseAdapter: DatabaseAdapter
): Promise<void> {
  const humanUserCount = await databaseAdapter.countHumanUsers();

  if (humanUserCount > 0) {
    throw new NakamaApiError(
      "Setup import is only available before the first admin account is created.",
      409
    );
  }
}
