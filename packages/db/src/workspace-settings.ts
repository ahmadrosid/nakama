import { WORKSPACE_SETTINGS_ID } from "./constants";
import type { StoredWorkspaceSettingsRecord } from "./types";

/** Missing / unset means passthrough (the v1 default). */
export function isCodingAgentProviderPassthroughEnabled(
  settings: Pick<
    StoredWorkspaceSettingsRecord,
    "codingAgentProviderPassthrough"
  > | null
): boolean {
  return settings?.codingAgentProviderPassthrough !== false;
}

export function mergeWorkspaceSettings(
  existing: StoredWorkspaceSettingsRecord | null | undefined,
  patch: Partial<StoredWorkspaceSettingsRecord> = {}
): StoredWorkspaceSettingsRecord {
  return {
    codingAgentHarnesses:
      patch.codingAgentHarnesses ?? existing?.codingAgentHarnesses ?? [],
    codingAgentProviderPassthrough:
      patch.codingAgentProviderPassthrough ??
      existing?.codingAgentProviderPassthrough ??
      true,
    id: patch.id ?? existing?.id ?? WORKSPACE_SETTINGS_ID,
    imageModel: patch.imageModel ?? existing?.imageModel ?? null,
    orgId: patch.orgId ?? existing?.orgId,
    selectedCodingAgentHarness:
      patch.selectedCodingAgentHarness === undefined
        ? (existing?.selectedCodingAgentHarness ?? null)
        : patch.selectedCodingAgentHarness,
    tokenOptimizerEnabled:
      patch.tokenOptimizerEnabled === undefined
        ? existing?.tokenOptimizerEnabled
        : patch.tokenOptimizerEnabled,
    transcriptionModel:
      patch.transcriptionModel ?? existing?.transcriptionModel ?? null,
    updatedAt:
      patch.updatedAt ?? existing?.updatedAt ?? new Date().toISOString(),
    visionModel: patch.visionModel ?? existing?.visionModel ?? null,
  };
}
