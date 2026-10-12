import {
  NakamaApiError,
  type ToolContext,
  type UserConfig,
} from "@nakama/core";
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
import type { OrgService } from "./org-service";
import {
  modelExistsOnInstance,
  resolveConfiguredModelInstance,
} from "./provider-instance-helpers";

async function resolveProfileModelId(
  db: DatabaseAdapter,
  profileId: string,
  context: ToolContext,
  userConfig: UserConfig | null | undefined,
  orgService?: OrgService
): Promise<string | null> {
  const profile = context.orgId
    ? await db.getProfileForOrg(profileId, context.orgId)
    : await db.getProfile(profileId);

  if (!profile) {
    throw new NakamaApiError("Profile not found.", 404);
  }

  if (
    profile.orgId &&
    (await db.getSharedAgentInstance(profile.orgId, profileId))
  ) {
    if (!(context.orgId && orgService)) {
      throw new NakamaApiError("Shared agent is unavailable.", 503);
    }

    const shared = await orgService.resolveSharedAgentProfile(
      context.orgId,
      profileId
    );

    if (!shared) {
      throw new NakamaApiError("Shared agent is unavailable.", 404);
    }

    const selected = resolveConfiguredModelInstance(userConfig, shared.model, {
      invalid: "Select a configured model.",
      missingProvider: "The model provider is unavailable.",
    });

    if (
      selected &&
      !modelExistsOnInstance(selected.instance, selected.modelId)
    ) {
      throw new NakamaApiError("Select a configured model.", 400);
    }

    return shared.model?.trim() || null;
  }

  return profile?.model?.trim() || null;
}

export async function enrichCodingAgentBashInput(
  db: DatabaseAdapter,
  input: BashInput,
  context: ToolContext,
  userConfig: UserConfig | null | undefined,
  orgService?: OrgService
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
      ? await resolveProfileModelId(
          db,
          context.profileId,
          context,
          userConfig,
          orgService
        )
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
