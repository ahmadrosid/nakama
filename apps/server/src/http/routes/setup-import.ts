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
  decodeArchiveRequestData,
  previewNakamaDataImport,
  restoreNakamaDataImport,
} from "../../services/data-portability";
import type { ServerOptions } from "../context";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

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

    await assertSetupImportAllowed(databaseAdapter);

    const body = await readJson<PreviewDataImportRequest>(c.req.raw);
    // Decoded outside the catch so an oversized archive keeps its 413.
    const archive = decodeArchiveRequestData(body.data);

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

    await assertSetupImportAllowed(databaseAdapter);

    const body = await readJson<RestoreDataImportRequest>(c.req.raw);
    const archive = decodeArchiveRequestData(body.data);

    let restore;
    try {
      restore = await restoreNakamaDataImport(archive, {
        confirm: body.confirm,
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

async function assertSetupImportAllowed(
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
