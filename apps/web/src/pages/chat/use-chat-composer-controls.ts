import type {
  ProviderModelOption,
  ThinkingEffort,
} from "@nakama/core/contract";
import { useMemo } from "react";
import { useAcpChatControls } from "@/hooks/use-acp-settings";
import {
  effectiveProfileModelSelection,
  groupModelsByProvider,
  resolveModelThinkingSupport,
} from "@/lib/models";
import {
  DEFAULT_THINKING_EFFORT,
  shouldShowThinkingEffort,
} from "@/lib/thinking-settings";

interface ChatComposerControlsInput {
  /** The profile uses an ACP agent, so the agent's settings replace the workspace lists. */
  acpAgentKey: string;
  acpEnabled: boolean;
  busy: boolean;
  canManageInstallSettings: boolean;
  currentProviderId: string | null | undefined;
  models: ProviderModelOption[] | undefined;
  profileId: string | null;
  profileModel: string | null | undefined;
  readOnlySession: boolean;
  saveThinkingPending: boolean;
  sessionId: string | null;
  sessionModel: string | null;
  thinkingSettingsEffort: ThinkingEffort | undefined;
  thinkingSettingsLoading: boolean;
}

/**
 * The composer's model and thinking controls. An ACP profile gets the agent's
 * lists and levels. Other profiles get the workspace's, as before.
 */
export function useChatComposerControls({
  acpAgentKey,
  acpEnabled,
  busy,
  canManageInstallSettings,
  currentProviderId,
  models,
  profileId,
  profileModel,
  readOnlySession,
  saveThinkingPending,
  sessionId,
  sessionModel,
  thinkingSettingsEffort,
  thinkingSettingsLoading,
}: ChatComposerControlsInput) {
  const acp = useAcpChatControls({
    agentKey: acpAgentKey,
    enabled: acpEnabled,
    profileId,
    sessionId,
  });

  const workspaceGroups = useMemo(
    () => groupModelsByProvider(models ?? []),
    [models]
  );

  const providerModelGroups = acpEnabled
    ? acp.providerModelGroups
    : workspaceGroups;

  const workspaceSelection = useMemo(
    () =>
      effectiveProfileModelSelection(
        sessionModel ?? profileModel,
        workspaceGroups,
        currentProviderId
      ),
    [currentProviderId, profileModel, sessionModel, workspaceGroups]
  );

  const currentModelSelection = acpEnabled
    ? acp.currentModelSelection
    : workspaceSelection;

  const activeModelSupportsThinking = useMemo(
    () =>
      resolveModelThinkingSupport(currentModelSelection, providerModelGroups),
    [currentModelSelection, providerModelGroups]
  );

  const effort = acpEnabled
    ? {
        disabled: busy || readOnlySession || acp.isSaving,
        options: acp.effortOptions,
        value: acp.effortValue,
        visible: acp.hasEffort,
      }
    : {
        disabled:
          !canManageInstallSettings ||
          busy ||
          thinkingSettingsLoading ||
          saveThinkingPending ||
          readOnlySession,
        options: undefined,
        value: thinkingSettingsEffort ?? DEFAULT_THINKING_EFFORT,
        visible: shouldShowThinkingEffort(activeModelSupportsThinking),
      };

  return {
    acpEnabled,
    activeModelSupportsThinking,
    currentModelSelection,
    providerModelGroups,
    setAcpEffort: acp.setEffort,
    setAcpModel: acp.setModel,
    thinkingEffort: effort.value,
    thinkingEffortDisabled: effort.disabled,
    thinkingEffortOptions: effort.options,
    thinkingEffortVisible: effort.visible,
  };
}
