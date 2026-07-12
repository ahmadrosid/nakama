import type { DatabaseAdapter } from "@nakama/db";
import type { ToolContext } from "@nakama/core";
import {
  buildSpawnEnvForHarness,
  getInferenceGatewayBaseUrl,
  normalizeCodingAgentModel,
} from "./coding-agent-spawn-env";
import {
  isCodingAgentCommand,
  loadCodingAgentWorkspaceSettings,
  resolveCodingAgentHarness,
} from "./coding-agent-harness-service";
import { loadLocalAuthToken } from "@nakama/core";

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
): Promise<unknown> {
  if (typeof input !== "object" || input === null) {
    return input;
  }

  const record = input as Record<string, unknown>;
  const command = typeof record.command === "string" ? record.command.trim() : "";

  if (!command) {
    return input;
  }

  const settings = await loadCodingAgentWorkspaceSettings(db);
  const codingAgentRequested = record.codingAgent === true;
  const matchesHarness = isCodingAgentCommand(command, settings.harnesses);

  if (!codingAgentRequested && !matchesHarness) {
    return input;
  }

  const harness = await resolveCodingAgentHarness(db);
  const profileId = context.profileId?.trim();
  const profileModel =
    profileId !== undefined && profileId.length > 0
      ? normalizeCodingAgentModel(await resolveProfileModelId(db, profileId))
      : null;
  const gatewayBaseUrl = getInferenceGatewayBaseUrl();
  const authToken = gatewayBaseUrl ? await resolveInferenceAuthToken() : null;
  const spawnEnv = buildSpawnEnvForHarness(harness.kind, {
    model: profileModel,
    gatewayBaseUrl,
    authToken,
    orgId: context.orgId,
    profileId: context.profileId,
  });
  const explicitEnv = readStringRecord(record.env);
  const mergedEnv = { ...spawnEnv, ...explicitEnv };

  if (Object.keys(mergedEnv).length === 0 && !codingAgentRequested) {
    return input;
  }

  return {
    ...record,
    codingAgent: true,
    ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
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

async function resolveInferenceAuthToken(): Promise<string | null> {
  try {
    return await loadLocalAuthToken();
  } catch {
    return null;
  }
}
