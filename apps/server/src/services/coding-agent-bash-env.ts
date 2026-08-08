import type { ToolContext, UserConfig } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import {
  inferCodingAgentHarnessKind,
  isCodingAgentCommand,
  loadCodingAgentWorkspaceSettings,
  resolveCodingAgentHarness,
} from "./coding-agent-harness-service";
import {
  mergeCodingAgentSpawnEnv,
  resolveCodingAgentSpawnBundle,
} from "./coding-agent-spawn-env";

export async function resolveProfileModelId(
  db: DatabaseAdapter,
  profileId: string
): Promise<string | null> {
  const profile = await db.getProfile(profileId);

  return profile?.model?.trim() || null;
}

export async function enrichCodingAgentBashInput(
  db: DatabaseAdapter,
  input: unknown,
  context: ToolContext,
  userConfig: UserConfig | null | undefined
): Promise<unknown> {
  if (typeof input !== "object" || input === null) {
    return input;
  }

  const record = input as Record<string, unknown>;
  const command =
    typeof record.command === "string" ? record.command.trim() : "";

  if (!command) {
    return input;
  }

  const workspace = await loadCodingAgentWorkspaceSettings(db);
  const codingAgentRequested = record.codingAgent === true;
  const matchesHarness = isCodingAgentCommand(command, workspace.harnesses);
  const inferredKind = inferCodingAgentHarnessKind(
    command,
    workspace.harnesses
  );

  if (!(codingAgentRequested || matchesHarness)) {
    return input;
  }

  if (codingAgentRequested && !inferredKind) {
    throw new Error(
      "codingAgent was set but the bash command does not start with a known coding-agent CLI (codex, claude, opencode, pi, or agent). Use the harness binary as argv0 so Nakama can merge the correct provider passthrough env."
    );
  }

  const profileModel =
    context.profileId !== undefined && context.profileId.length > 0
      ? await resolveProfileModelId(db, context.profileId)
      : null;
  const harness = await resolveCodingAgentHarness(db, inferredKind, {
    profileModel,
    userConfig,
  });
  const { spawn } = await resolveCodingAgentSpawnBundle({
    harnessKind: harness.kind,
    profileModel,
    userConfig,
  });
  const explicitEnv = readStringRecord(record.env);
  const mergedEnv = mergeCodingAgentSpawnEnv(process.env, spawn.env, {
    callerEnv: explicitEnv,
    protectCredentialKeys: spawn.env && Object.keys(spawn.env).length > 0,
  });

  if (Object.keys(mergedEnv).length === 0 && !codingAgentRequested) {
    return input;
  }

  const envRecord = Object.fromEntries(
    Object.entries(mergedEnv).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
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

  const entries = Object.entries(value as Record<string, unknown>).flatMap(
    ([key, entry]) => {
      if (typeof entry !== "string") {
        return [];
      }

      return [[key, entry] as const];
    }
  );

  return Object.fromEntries(entries);
}
