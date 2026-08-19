import { NakamaApiError } from "@nakama/core";
import {
  listCodingHarnessLoginCommands,
  loadCodingAgentWorkspaceSettings,
  saveCodingAgentWorkspaceSettings,
} from "../../services/coding-agent-harness-service";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgAdminOrPlatformAdminFromContext,
} from "../org-guards";
import { json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerCodingHarnessSettingsRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  app.get("/v1/settings/coding-harnesses", async (c) => {
    requireActiveOrgIdFromContext(c);
    const settings = await loadCodingAgentWorkspaceSettings(
      options.databaseAdapter
    );

    return json({
      loginCommands: listCodingHarnessLoginCommands(),
      providerPassthroughEnabled: settings.providerPassthroughEnabled,
    });
  });

  app.put("/v1/settings/coding-harnesses", async (c) => {
    // Workspace-global, same bar as other install-wide settings (#305).
    // Per-org isolation of this flag is #307.
    requireOrgAdminOrPlatformAdminFromContext(c);
    const body = await readJson<{ providerPassthroughEnabled?: boolean }>(
      c.req.raw
    );

    if (typeof body.providerPassthroughEnabled !== "boolean") {
      throw new NakamaApiError(
        "providerPassthroughEnabled must be a boolean.",
        400
      );
    }

    const settings = await saveCodingAgentWorkspaceSettings(
      options.databaseAdapter,
      { providerPassthroughEnabled: body.providerPassthroughEnabled }
    );

    return json({
      loginCommands: listCodingHarnessLoginCommands(),
      providerPassthroughEnabled: settings.providerPassthroughEnabled,
    });
  });
}
