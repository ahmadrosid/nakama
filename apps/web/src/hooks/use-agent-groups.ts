import type { AgentGroup } from "@nakama/core/agent-groups";
import type { ImageAttachment } from "@nakama/core/contract";
import { toast } from "@nakama/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useAgentGroupsQuery() {
  return useQuery({
    queryFn: async () => (await client.listAgentGroups()).groups,
    queryKey: queryKeys.agentGroups.all,
  });
}

export function useAgentGroupQuery(groupId: string) {
  return useQuery({
    enabled: Boolean(groupId),
    queryFn: () => client.getAgentGroup(groupId),
    queryKey: queryKeys.agentGroups.detail(groupId),
  });
}

/** A group's sessions, latest first; refreshed while any of them is replying. */
export function useGroupSessionsQuery(groupId: string) {
  return useQuery({
    enabled: Boolean(groupId),
    queryFn: async () =>
      (await client.listAgentGroupSessions(groupId)).sessions,
    queryKey: queryKeys.agentGroups.sessions(groupId),
    refetchInterval: (query) =>
      query.state.data?.some((session) => session.active) ? 3000 : false,
  });
}

export function useUpdateGroupSession(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      changes,
      sessionId,
    }: {
      changes: { pinned?: boolean; title?: string };
      sessionId: string;
    }) => client.updateAgentGroupSession(groupId, sessionId, changes),
    onError: (error) => toast(formatError(error)),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.agentGroups.sessions(groupId),
      }),
  });
}

export function useDeleteGroupSession(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      client.deleteAgentGroupSession(groupId, sessionId),
    onError: (error) => toast(formatError(error)),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.agentGroups.sessions(groupId),
      }),
  });
}

/** Agent and group ids pinned to the top of the rail, latest pin first. */
export function useRailPinsQuery() {
  return useQuery({
    queryFn: async () => (await client.listRailPins()).itemIds,
    queryKey: queryKeys.railPins,
  });
}

export function useToggleRailPin() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ itemId, pinned }: { itemId: string; pinned: boolean }) =>
      client.setRailPin(itemId, pinned),
    onError: (error) => toast(formatError(error)),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.railPins }),
  });

  return mutation.mutate;
}

export interface GroupDraft {
  /** A new image, `null` to remove the current one, `undefined` to keep it. */
  image?: ImageAttachment | null;
  memberIds: string[];
  name: string;
}

/** Creates a group, or saves an edit when `groupId` is given, image included. */
export function useSaveGroup(groupId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ image, memberIds, name }: GroupDraft) => {
      const group = groupId
        ? await client.updateAgentGroup(groupId, { memberIds, name })
        : await client.createAgentGroup({ memberIds, name });

      if (image) {
        await client.uploadAgentGroupAvatar(group.id, image);
      } else if (image === null) {
        await client.deleteAgentGroupAvatar(group.id);
      }

      return group;
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.agentGroups.all }),
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (groupId: string) => client.deleteAgentGroup(groupId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agentGroups.all }),
        // The server drops the deleted group's rail pin too.
        queryClient.invalidateQueries({ queryKey: queryKeys.railPins }),
      ]),
  });
}

export function groupAvatarUrl(group: AgentGroup): string | null {
  return group.avatarVersion
    ? `/v1/agent-groups/${encodeURIComponent(group.id)}/avatar?v=${encodeURIComponent(group.avatarVersion)}`
    : null;
}
