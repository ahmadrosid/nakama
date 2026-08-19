import { NakamaApiError } from "@nakama/core";
import {
  getCodingHarnessLoginCommand,
  loadCodingAgentWorkspaceSettings,
  saveCodingAgentWorkspaceSettings,
} from "../../services/coding-agent-harness-service";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgAdminFromContext,
} from "../org-guards";
import { json, readJson } from "../shared";
import type { HonoApp } from "../types";

const HARNESS_LOGIN_ORDER = [
  { kind: "codex" as const, name: "Codex" },
  { kind: "claude_code" as const, name: "Claude Code" },
  { kind: "opencode" as const, name: "OpenCode" },
  { kind: "pi" as const, name: "pi" },
];

function loginCommands() {
  return HARNESS_LOGIN_ORDER.flatMap((harness) => {
    const command = getCodingHarnessLoginCommand(harness.kind);
    return command ? [{ command, name: harness.name }] : [];
  });
}

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
      loginCommands: loginCommands(),
      providerPassthroughEnabled: settings.providerPassthroughEnabled,
    });
  });

  app.put("/v1/settings/coding-harnesses", async (c) => {
    requireOrgAdminFromContext(c);
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
      loginCommands: loginCommands(),
      providerPassthroughEnabled: settings.providerPassthroughEnabled,
    });
  });
}
