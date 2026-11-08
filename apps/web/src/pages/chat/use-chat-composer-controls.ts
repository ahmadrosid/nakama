import type {
  ProviderModelOption,
  ThinkingEffort,
} from "@nakama/core/contract";
import { clampThinkingEffort } from "@nakama/core/thinking-effort";
import { useMemo } from "react";
import { useAcpChatControls } from "@/hooks/use-acp-settings";
import {
  effectiveProfileModelSelection,
  findSelectedModel,
  groupModelsByProvider,
  resolveModelThinkingSupport,
} from "@/lib/models";
import {
  DEFAULT_THINKING_EFFORT,
  shouldShowThinkingEffort,
  thinkingEffortOptionsFor,
} from "@/lib/thinking-settings";

interface ChatComposerControlsInput {
  /** The profile uses an ACP agent, so the agent's settings replace the workspace lists. */
  acpAgentKey: string;
  acpEnabled: boolean;
  busy: boolean;
  currentProviderId: string | null | undefined;
  models: ProviderModelOption[] | undefined;
  profileId: string | null;
  profileModel: string | null | undefined;
  readOnlySession: boolean;
  saveThinkingPending: boolean;
  sessionId: string | null;
  sessionModel: string | null;
  /** This chat's own effort. Null follows the install effort. */
  sessionThinkingEffort: ThinkingEffort | null;
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
  currentProviderId,
  models,
  profileId,
  profileModel,
  readOnlySession,
  saveThinkingPending,
  sessionId,
  sessionModel,
  sessionThinkingEffort,
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

  const activeModel = useMemo(
    () => findSelectedModel(currentModelSelection, providerModelGroups),
    [currentModelSelection, providerModelGroups]
  );

  const activeModelSupportsThinking = resolveModelThinkingSupport(activeModel);

  // This chat's own effort, else the install effort. The picker shows it
  // lowered to what the active model takes, and saves compare against it.
  const savedThinkingEffort =
    sessionThinkingEffort ?? thinkingSettingsEffort ?? DEFAULT_THINKING_EFFORT;

  const workspaceEffortOptions = useMemo(
    () => thinkingEffortOptionsFor(activeModel),
    [activeModel]
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
          busy ||
          thinkingSettingsLoading ||
          saveThinkingPending ||
          readOnlySession,
        options: workspaceEffortOptions,
        // Show what the server will send: Max saved on DeepSeek reads as High on Gemini.
        value: activeModel
          ? clampThinkingEffort(
              savedThinkingEffort,
              activeModel.id,
              activeModel.provider
            )
          : savedThinkingEffort,
        visible: shouldShowThinkingEffort(activeModelSupportsThinking),
      };

  return {
    acpEnabled,
    activeModelSupportsThinking,
    currentModelSelection,
    providerModelGroups,
    savedThinkingEffort,
    setAcpEffort: acp.setEffort,
    setAcpModel: acp.setModel,
    thinkingEffort: effort.value,
    thinkingEffortDisabled: effort.disabled,
    thinkingEffortOptions: effort.options,
    thinkingEffortVisible: effort.visible,
  };
}
