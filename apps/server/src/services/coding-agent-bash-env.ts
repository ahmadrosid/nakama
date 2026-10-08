import type { ToolContext, UserConfig } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import type { BashInput } from "../tools/bash";
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

async function resolveProfileModelId(
  db: DatabaseAdapter,
  profileId: string
): Promise<string | null> {
  const profile = await db.getProfile(profileId);

  return profile?.model?.trim() || null;
}

export async function enrichCodingAgentBashInput(
  db: DatabaseAdapter,
  input: BashInput,
  context: ToolContext,
  userConfig: UserConfig | null | undefined
): Promise<BashInput> {
  const command = input.command.trim();

  if (!command) {
    return input;
  }

  const workspace = await loadCodingAgentWorkspaceSettings(db);
  const codingAgentRequested = input.codingAgent === true;
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
    providerPassthroughEnabled: workspace.providerPassthroughEnabled,
    userConfig,
  });

  if (
    !workspace.providerPassthroughEnabled ||
    harness.kind === "cursor_agent"
  ) {
    return {
      ...input,
      codingAgent: true,
    };
  }

  const { spawn } = await resolveCodingAgentSpawnBundle({
    harnessKind: harness.kind,
    profileModel,
    userConfig,
  });

  const explicitEnv = input.env;

  const mergedEnv = mergeCodingAgentSpawnEnv(process.env, spawn.env, {
    callerEnv: explicitEnv,
    protectCredentialKeys: spawn.env && Object.keys(spawn.env).length > 0,
  });

  if (Object.keys(mergedEnv).length === 0 && !codingAgentRequested) {
    return input;
  }

  const enriched: BashInput = {
    ...input,
    codingAgent: true,
  };

  if (Object.keys(mergedEnv).length > 0) {
    enriched.env = mergedEnv;
  }

  return enriched;
}
