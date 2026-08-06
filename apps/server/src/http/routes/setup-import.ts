import { createRoute, z } from "@hono/zod-openapi";
import {
  NakamaApiError,
  type DataImportPreviewResponse,
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
import { errorResponse, json, readJson } from "../shared";
import type { ServerOptions } from "../context";
import type { HonoApp } from "../types";

export function registerSetupImportRoutes(app: HonoApp, options: ServerOptions): void {
  const { databaseAdapter } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
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
  const previewResponseSchema = z.object({}).passthrough().openapi("SetupDataImportPreviewResponse");
  const restoreResponseSchema = z.object({}).passthrough().openapi("SetupRestoreDataImportResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/auth/setup/import/preview",
      tags: ["Auth"],
      summary: "Preview Nakama data import during first-time setup",
      operationId: "previewSetupDataImport",
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
        409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/auth/setup/import/restore",
      tags: ["Auth"],
      summary: "Restore Nakama data import during first-time setup",
      operationId: "restoreSetupDataImport",
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
        409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
        500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      },
    }),
  );

  app.post("/v1/auth/setup/import/preview", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }

    try {
      await assertSetupImportAllowed(databaseAdapter);
    } catch (error) {
      return setupImportErrorResponse(error);
    }

    const body = await readJson<PreviewDataImportRequest>(c.req.raw);

    try {
      const preview = await previewNakamaDataImport(decodeArchiveRequestData(body.data));
      return json<DataImportPreviewResponse>(preview);
    } catch (error) {
      return errorResponse(formatImportError(error), 400);
    }
  });

  app.post("/v1/auth/setup/import/restore", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }

    try {
      await assertSetupImportAllowed(databaseAdapter);
    } catch (error) {
      return setupImportErrorResponse(error);
    }

    const body = await readJson<RestoreDataImportRequest>(c.req.raw);

    let restore;
    try {
      restore = await restoreNakamaDataImport(decodeArchiveRequestData(body.data), {
        confirm: body.confirm,
      });
    } catch (error) {
      return errorResponse(formatImportError(error), 400);
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

async function assertSetupImportAllowed(databaseAdapter: DatabaseAdapter): Promise<void> {
  const humanUserCount = await databaseAdapter.countHumanUsers();
  if (humanUserCount > 0) {
    throw new NakamaApiError(
      "Setup import is only available before the first admin account is created.",
      409,
    );
  }
}

function setupImportErrorResponse(error: unknown): Response {
  if (error instanceof NakamaApiError) {
    return errorResponse(error.message, error.status);
  }

  return errorResponse(formatImportError(error), 500);
}

function formatImportError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
