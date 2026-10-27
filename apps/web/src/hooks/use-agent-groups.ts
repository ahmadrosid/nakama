import type {
  AgentGroup,
  AgentGroupMessage,
  AgentGroupRun,
  AgentGroupSessionDetail,
  AgentGroupThreadDetail,
} from "@nakama/core/agent-groups";
import type {
  DocumentAttachment,
  ImageAttachment,
} from "@nakama/core/contract";
import { toast } from "@nakama/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
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

/** Shown until the server confirms a reply run, so the page reacts at once. */
export const PENDING_RUN: AgentGroupRun = {
  activity: null,
  speakerProfileId: null,
  stopping: false,
};

/**
 * The user's message as it will look once saved. Attached documents show by
 * name; a pasted image shows once the server has saved it. A negative id never
 * clashes with the server's, which start at 1.
 */
export function pendingMessage(
  content: string,
  documents: DocumentAttachment[] = []
): AgentGroupMessage {
  const files = documents.flatMap((document) =>
    document.mediaType.startsWith("image/") ? [] : [document.filename]
  );

  return {
    authorProfileId: null,
    content,
    createdAt: new Date().toISOString(),
    ...(files.length > 0 && { files }),
    id: -Date.now(),
    threadReplies: 0,
  };
}

interface GroupConversation<Detail> {
  data: Detail | undefined;
  error: Error | null;
  isLoading: boolean;
  /** Shows the message at once; rejects, after a toast, when the send fails. */
  send: (content: string, documents?: DocumentAttachment[]) => Promise<void>;
  stop: () => void;
}

/**
 * A group chat, or with `rootId` the thread on that message: polled while
 * agents reply. A sent message shows at once, and polls wait until the server
 * has it, so an early poll cannot erase it. The refresh after the send keeps
 * it, or rolls it back when the send failed.
 */
export function useGroupConversation(
  groupId: string,
  sessionId: string
): GroupConversation<AgentGroupSessionDetail>;

export function useGroupConversation(
  groupId: string,
  sessionId: string,
  rootId: number
): GroupConversation<AgentGroupThreadDetail>;

export function useGroupConversation(
  groupId: string,
  sessionId: string,
  rootId?: number
): GroupConversation<AgentGroupSessionDetail | AgentGroupThreadDetail> {
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const sessionKey = queryKeys.agentGroups.session(groupId, sessionId);

  const key =
    rootId === undefined
      ? sessionKey
      : queryKeys.agentGroups.thread(groupId, sessionId, rootId);

  const { data, error, isLoading } = useQuery<
    AgentGroupSessionDetail | AgentGroupThreadDetail
  >({
    queryFn: () =>
      rootId === undefined
        ? client.getAgentGroupSession(groupId, sessionId)
        : client.getAgentGroupThread(groupId, sessionId, rootId),
    queryKey: key,
    // Poll only while agents are replying, here or in one of its threads.
    refetchInterval: (query) => {
      const detail = query.state.data;

      const threads =
        detail && "threadRunIds" in detail ? detail.threadRunIds.length : 0;

      return !sending && (detail?.run || threads > 0) ? 1500 : false;
    },
  });

  // The session key is the thread key's parent, so a thread's reply count
  // refreshes with it.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionKey }),
      queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.agentGroups.sessions(groupId),
      }),
    ]).then(() => undefined);

  async function send(content: string, documents: DocumentAttachment[] = []) {
    setSending(true);
    await queryClient.cancelQueries({ exact: true, queryKey: key });
    queryClient.setQueryData<AgentGroupSessionDetail | AgentGroupThreadDetail>(
      key,
      (detail) =>
        detail && {
          ...detail,
          messages: [...detail.messages, pendingMessage(content, documents)],
          run: detail.run ?? PENDING_RUN,
        }
    );

    try {
      await (rootId === undefined
        ? client.sendAgentGroupMessage(groupId, sessionId, content, documents)
        : client.sendAgentGroupThreadMessage(
            groupId,
            sessionId,
            rootId,
            content,
            documents
          ));
    } catch (sendError) {
      toast(formatError(sendError));
      throw sendError;
    } finally {
      setSending(false);
      void refresh();
    }
  }

  const stop = () =>
    void (
      rootId === undefined
        ? client.stopAgentGroupSession(groupId, sessionId)
        : client.stopAgentGroupThread(groupId, sessionId, rootId)
    )
      .then(refresh)
      .catch((stopError) => toast(formatError(stopError)));

  return { data, error, isLoading, send, stop };
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
  brief: string;
  /** A new image, `null` to remove the current one, `undefined` to keep it. */
  image?: ImageAttachment | null;
  memberIds: string[];
  name: string;
}

/** Creates a group, or saves an edit when `groupId` is given, image included. */
export function useSaveGroup(groupId?: string) {
  const queryClient = useQueryClient();
  const createdGroupId = useRef<string | null>(null);

  return useMutation({
    mutationFn: async ({ brief, image, memberIds, name }: GroupDraft) => {
      const savedGroupId = groupId ?? createdGroupId.current;

      const group = savedGroupId
        ? await client.updateAgentGroup(savedGroupId, {
            brief,
            memberIds,
            name,
          })
        : await client.createAgentGroup({ brief, memberIds, name });

      if (!savedGroupId) {
        createdGroupId.current = group.id;
      }

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
