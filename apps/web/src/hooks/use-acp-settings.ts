import type { AcpSessionSetting } from "@nakama/core/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { ACP_PROVIDER_ID, acpModelGroups } from "@/lib/acp-settings";
import { client } from "@/lib/client";
import { decodeModelSelection, encodeModelSelection } from "@/lib/models";
import { queryKeys } from "@/lib/query-keys";

interface UseAcpSettingsOptions {
  /** Only profiles that use an ACP agent have settings. */
  agentKey: string;
  enabled: boolean;
  profileId: string | null;
  /** Null before the first message: the draft settings apply then. */
  sessionId: string | null;
}

/**
 * The model and reasoning settings an ACP agent offers. Before a chat has a
 * session, the profile's draft settings are used; the agent keeps them once
 * the chat starts.
 */
function useAcpSettings({
  agentKey,
  enabled,
  profileId,
  sessionId,
}: UseAcpSettingsOptions) {
  const queryClient = useQueryClient();

  const queryKey = sessionId
    ? queryKeys.acpSettings.session(sessionId, agentKey)
    : queryKeys.acpSettings.profile(profileId ?? "", agentKey);

  const query = useQuery({
    enabled: enabled && Boolean(sessionId || profileId),
    queryFn: async () =>
      sessionId
        ? client.getSessionAcpSettings(sessionId)
        : client.getProfileAcpSettings(profileId ?? ""),
    queryKey,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const mutation = useMutation({
    mutationFn: ({ configId, value }: { configId: string; value: string }) =>
      sessionId
        ? client.setSessionAcpSetting(sessionId, configId, value)
        : client.setProfileAcpSetting(profileId ?? "", configId, value),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKey, response);
    },
  });

  const settings: AcpSessionSetting[] = query.data?.settings ?? [];
  const { mutate } = mutation;

  const setSetting = useCallback(
    (configId: string, value: string) => mutate({ configId, value }),
    [mutate]
  );

  return {
    effort: settings.find((setting) => setting.category === "thought_level"),
    isSaving: mutation.isPending,
    model: settings.find((setting) => setting.category === "model"),
    setSetting,
  };
}

interface UseAcpChatControlsOptions {
  agentKey: string;
  enabled: boolean;
  profileId: string | null;
  sessionId: string | null;
}

/**
 * What the chat composer shows for an ACP agent: its model list, the chosen
 * model and effort, and the setters that send a change to the agent.
 */
export function useAcpChatControls({
  agentKey,
  enabled,
  profileId,
  sessionId,
}: UseAcpChatControlsOptions) {
  const { effort, isSaving, model, setSetting } = useAcpSettings({
    agentKey,
    enabled,
    profileId,
    sessionId,
  });

  const providerModelGroups = useMemo(() => acpModelGroups(model), [model]);

  const effortOptions = useMemo(
    () =>
      effort?.options.map((option) => ({
        label: option.name,
        value: option.value,
      })),
    [effort]
  );

  // Takes the composer's `provider::model` selection and sends only the model id.
  const setModel = useCallback(
    (selection: string) => {
      const decoded = decodeModelSelection(selection);

      if (model && decoded) {
        setSetting(model.id, decoded.modelId);
      }
    },
    [model, setSetting]
  );

  const setEffort = useCallback(
    (value: string) => {
      if (effort) {
        setSetting(effort.id, value);
      }
    },
    [effort, setSetting]
  );

  return useMemo(
    () => ({
      currentModelSelection: model
        ? encodeModelSelection(ACP_PROVIDER_ID, model.currentValue)
        : null,
      effortOptions,
      effortValue: effort?.currentValue ?? "",
      hasEffort: Boolean(effort),
      isSaving,
      providerModelGroups,
      setEffort,
      setModel,
    }),
    [
      effort,
      effortOptions,
      isSaving,
      model,
      providerModelGroups,
      setEffort,
      setModel,
    ]
  );
}
