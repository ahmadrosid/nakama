import type { AcpSessionSetting } from "@nakama/core/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

interface UseAcpSettingsOptions {
  /** Only profiles that use an ACP agent have settings. */
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
export function useAcpSettings({
  enabled,
  profileId,
  sessionId,
}: UseAcpSettingsOptions) {
  const queryClient = useQueryClient();

  const queryKey = sessionId
    ? queryKeys.acpSettings.session(sessionId)
    : queryKeys.acpSettings.profile(profileId ?? "");

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
