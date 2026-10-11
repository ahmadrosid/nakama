import { z } from "@hono/zod-openapi";
import { mergeWorkspaceSettings } from "@nakama/db";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { json, readJson } from "../shared";
import type { HonoApp } from "../types";

const DEFAULT_POLL_INTERVAL_MINUTES = 5;

const MAX_POLL_INTERVAL_MINUTES = 24 * 60;

const MINUTE_MS = 60 * 1000;

export function registerAutomationWorkerSettingsRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const databaseAdapter = options.databaseAdapter;

  if (!databaseAdapter) {
    return;
  }

  app.get("/v1/settings/automation-worker", async (c) => {
    requireActiveOrgIdFromContext(c);
    const settings = await databaseAdapter.getWorkspaceSettings();

    return json({
      pollIntervalMinutes: toPollIntervalMinutes(
        settings?.automationWorkerPollIntervalMs
      ),
    });
  });

  app.put("/v1/settings/automation-worker", async (c) => {
    requirePlatformAdminFromContext(c);

    const body = await readJson(
      c.req.raw,
      z
        .object({
          pollIntervalMinutes: z
            .number()
            .int()
            .min(1)
            .max(MAX_POLL_INTERVAL_MINUTES),
        })
        .strict()
    );

    const existing = await databaseAdapter.getWorkspaceSettings();
    const pollIntervalMinutes = body.pollIntervalMinutes;
    await databaseAdapter.upsertWorkspaceSettings(
      mergeWorkspaceSettings(existing, {
        automationWorkerPollIntervalMs: pollIntervalMinutes * MINUTE_MS,
        updatedAt: new Date().toISOString(),
      })
    );

    return json({ pollIntervalMinutes });
  });
}

function toPollIntervalMinutes(intervalMs: number | undefined): number {
  const minutes =
    (intervalMs ?? DEFAULT_POLL_INTERVAL_MINUTES * MINUTE_MS) / MINUTE_MS;

  return Number.isInteger(minutes) && minutes > 0
    ? minutes
    : DEFAULT_POLL_INTERVAL_MINUTES;
}
