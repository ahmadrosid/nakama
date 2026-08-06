import type {
  CodingAgentProviderPassthroughSummary,
  CodingHarnessSettingsResponse,
  UpdateCodingHarnessSettingsRequest,
  UserConfig,
  VerifyCodingHarnessResponse,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import {
  getCodingHarnessInstallCommand,
  getCodingHarnessInstallHint,
  listCodingAgentHarnessStatuses,
  loadCodingAgentWorkspaceSettings,
  saveCodingAgentWorkspaceSettings,
  verifyCodingAgentHarness,
} from "./coding-agent-harness-service";
import {
  resolveCodingAgentProviderRouting,
  type CodingAgentProviderRouting,
} from "./coding-agent-provider-routing";

const HARNESS_KINDS = ["codex", "claude_code", "opencode"] as const;

export function toPassthroughSummary(
  routing: CodingAgentProviderRouting | null | undefined,
): CodingAgentProviderPassthroughSummary {
  if (!routing) {
    return {
      active: false,
      configured: false,
      compatible: false,
      providerLabel: null,
      model: null,
      message: "No LLM provider is configured. Add one in Settings → Provider.",
    };
  }

  return {
    active: Boolean(routing.active && routing.configured && routing.compatible),
    configured: routing.configured,
    compatible: routing.compatible,
    providerLabel: routing.providerLabel,
    model: routing.model,
    message: routing.error,
  };
}

export async function getCodingHarnessSettings(
  db: DatabaseAdapter,
  userConfig: UserConfig | null | undefined,
): Promise<CodingHarnessSettingsResponse> {
  const settings = await loadCodingAgentWorkspaceSettings(db);
  const profileModel: string | null = null;
  const routingByKind = new Map(
    HARNESS_KINDS.map((kind) => [
      kind,
      resolveCodingAgentProviderRouting({
        userConfig,
        profileModel,
        harnessKind: kind,
      }),
    ]),
  );
  const selectedHarness = settings.selectedHarnessId
    ? settings.harnesses.find((harness) => harness.id === settings.selectedHarnessId)
    : null;
  const selectedRouting = selectedHarness
    ? routingByKind.get(selectedHarness.kind) ?? null
    : null;
  const statuses = await listCodingAgentHarnessStatuses(db, {
    probeContext: {
      userConfig,
      profileModel,
    },
  });
  const selectedStatus = settings.selectedHarnessId
    ? statuses.find(
        (harness) =>
          harness.id === settings.selectedHarnessId &&
          harness.enabled &&
          harness.installed &&
          harness.ready,
      ) ?? null
    : null;

  return {
    configured: selectedStatus !== null,
    selectedHarnessId: settings.selectedHarnessId,
    activeHarnessId: selectedStatus?.id ?? null,
    providerPassthrough: toPassthroughSummary(selectedRouting),
    harnesses: statuses.map((harness) => ({
      id: harness.id,
      kind: harness.kind,
      name: harness.name,
      command: harness.command,
      enabled: harness.enabled,
      installed: harness.installed,
      version: harness.version,
      authenticated: harness.authenticated,
      ready: harness.ready,
      nextStep: harness.nextStep,
      statusMessage: harness.statusMessage,
      selected: harness.id === settings.selectedHarnessId,
      installHint: getCodingHarnessInstallHint(harness.kind),
      installCommand: getCodingHarnessInstallCommand(harness.kind),
    })),
  };
}

export async function setCodingHarnessSettings(
  db: DatabaseAdapter,
  userConfig: UserConfig | null | undefined,
  input: UpdateCodingHarnessSettingsRequest,
): Promise<CodingHarnessSettingsResponse> {
  await saveCodingAgentWorkspaceSettings(db, {
    selectedHarnessId: input.selectedHarnessId,
    harnesses: input.harnesses,
  });

  return getCodingHarnessSettings(db, userConfig);
}

export async function verifyCodingHarnessSettings(
  db: DatabaseAdapter,
  userConfig: UserConfig | null | undefined,
  harnessId?: string,
): Promise<VerifyCodingHarnessResponse> {
  return verifyCodingAgentHarness(db, harnessId, {
    userConfig,
    profileModel: null,
  });
}
