import type {
  AcpAgentConfig,
  AcpAgentPresetSummary,
  AcpSessionSetting,
  ProviderModelOption,
} from "@nakama/core/contract";

/** A stable empty list, so hooks that depend on the presets do not re-run every render. */
export const NO_ACP_AGENT_PRESETS: AcpAgentPresetSummary[] = [];

/**
 * The preset a saved agent came from. Null for the built-in chat, and for a
 * custom command that is not one of the presets.
 */
export function presetIdForAgent(
  agent: AcpAgentConfig | null | undefined,
  presets: AcpAgentPresetSummary[]
): string | null {
  if (!agent) {
    return null;
  }

  const match = presets.find(
    (preset) =>
      preset.agent.command === agent.command &&
      preset.agent.args.join("\u0000") === agent.args.join("\u0000")
  );

  return match?.id ?? null;
}

export function acpAgentSettingsKey(
  agent: AcpAgentConfig | null | undefined
): string {
  return agent ? `${agent.command}\u0000${agent.args.join("\u0000")}` : "";
}

/** Provider id for models an ACP agent reports. Never a real provider instance. */
export const ACP_PROVIDER_ID = "acp";

const ACP_PROVIDER_LABEL = "ACP agent";

/**
 * Shows the agent's model list as one provider group, so the composer's model
 * picker works the same for ACP chats as for other chats.
 */
export function acpModelGroups(model: AcpSessionSetting | undefined): Array<{
  providerId: string;
  providerLabel: string;
  models: ProviderModelOption[];
}> {
  if (!model) {
    return [];
  }

  return [
    {
      models: model.options.map((option) => ({
        id: option.value,
        name: option.name,
        provider: ACP_PROVIDER_ID,
        providerId: ACP_PROVIDER_ID,
        providerLabel: ACP_PROVIDER_LABEL,
      })),
      providerId: ACP_PROVIDER_ID,
      providerLabel: ACP_PROVIDER_LABEL,
    },
  ];
}
