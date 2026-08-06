import type { DatabaseAdapter } from "@nakama/db";
import type { ToolContext, UserConfig } from "@nakama/core";
import { mergeCodingAgentSpawnEnv } from "./coding-agent-spawn-env";
import {
  isCodingAgentCommand,
  loadCodingAgentWorkspaceSettings,
  resolveCodingAgentHarness,
} from "./coding-agent-harness-service";
import { resolveCodingAgentSpawnBundle } from "./coding-agent-spawn-env";

export async function resolveProfileModelId(
  db: DatabaseAdapter,
  profileId: string,
): Promise<string | null> {
  const profile = await db.getProfile(profileId);

  return profile?.model?.trim() || null;
}

export async function enrichCodingAgentBashInput(
  db: DatabaseAdapter,
  input: unknown,
  context: ToolContext,
  userConfig: UserConfig | null | undefined,
): Promise<unknown> {
  if (typeof input !== "object" || input === null) {
    return input;
  }

  const record = input as Record<string, unknown>;
  const command = typeof record.command === "string" ? record.command.trim() : "";

  if (!command) {
    return input;
  }

  const workspace = await loadCodingAgentWorkspaceSettings(db);
  const codingAgentRequested = record.codingAgent === true;
  const matchesHarness = isCodingAgentCommand(command, workspace.harnesses);

  if (!codingAgentRequested && !matchesHarness) {
    return input;
  }

  const profileModel =
    context.profileId !== undefined && context.profileId.length > 0
      ? await resolveProfileModelId(db, context.profileId)
      : null;
  const harness = await resolveCodingAgentHarness(db, null, {
    userConfig,
    profileModel,
  });
  const { spawn } = await resolveCodingAgentSpawnBundle({
    userConfig,
    profileModel,
    harnessKind: harness.kind,
  });
  const explicitEnv = readStringRecord(record.env);
  const mergedEnv = mergeCodingAgentSpawnEnv(process.env, spawn.env, {
    protectCredentialKeys: spawn.env && Object.keys(spawn.env).length > 0,
    callerEnv: explicitEnv,
  });

  if (Object.keys(mergedEnv).length === 0 && !codingAgentRequested) {
    return input;
  }

  const envRecord = Object.fromEntries(
    Object.entries(mergedEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  return {
    ...record,
    codingAgent: true,
    ...(Object.keys(envRecord).length > 0 ? { env: envRecord } : {}),
  };
}

function readStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    if (typeof entry !== "string") {
      return [];
    }

    return [[key, entry] as const];
  });

  return Object.fromEntries(entries);
}
