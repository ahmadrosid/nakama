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

function pickDefined<T>(patch: T | undefined, fallback: T): T {
  return patch === undefined ? fallback : patch;
}

export function mergeWorkspaceSettings(
  existing: StoredWorkspaceSettingsRecord | null | undefined,
  patch: Partial<StoredWorkspaceSettingsRecord> = {}
): StoredWorkspaceSettingsRecord {
  return {
    codingAgentHarnesses: pickDefined(
      patch.codingAgentHarnesses,
      existing?.codingAgentHarnesses ?? []
    ),
    codingAgentProviderPassthrough: pickDefined(
      patch.codingAgentProviderPassthrough,
      existing?.codingAgentProviderPassthrough ?? true
    ),
    id: pickDefined(patch.id, existing?.id ?? WORKSPACE_SETTINGS_ID),
    imageModel: pickDefined(patch.imageModel, existing?.imageModel ?? null),
    selectedCodingAgentHarness: pickDefined(
      patch.selectedCodingAgentHarness,
      existing?.selectedCodingAgentHarness ?? null
    ),
    tokenOptimizerEnabled:
      patch.tokenOptimizerEnabled === undefined
        ? existing?.tokenOptimizerEnabled
        : patch.tokenOptimizerEnabled,
    transcriptionModel: pickDefined(
      patch.transcriptionModel,
      existing?.transcriptionModel ?? null
    ),
    updatedAt: pickDefined(
      patch.updatedAt,
      existing?.updatedAt ?? new Date().toISOString()
    ),
    visionModel: pickDefined(patch.visionModel, existing?.visionModel ?? null),
  };
}
