import { NakamaApiError } from "@nakama/core/api-error";
import type {
  AgentChannel,
  CreateProfileRequest,
  DocumentAttachment,
  ImageAttachment,
  KnowledgeBaseDuplicateAction,
  SessionSummary,
  SoulStackFiles,
  UpdateProfileRequest,
  UpdateSessionRequest,
  UserContextStatusResponse,
  WorkspaceEntry,
} from "@nakama/core/contract";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { useRunningTurnsStore } from "@/context/running-turns-store";
import { useAuth } from "@/context/use-auth";
import { HISTORY_SESSION_CHANNELS } from "@/lib/chat-history";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { sessionListPollInterval } from "@/lib/session-list";

const EMPTY_USER_CONTEXT: UserContextStatusResponse = {
  active: false,
};

async function fetchUserContext(
  includeContent?: boolean
): Promise<UserContextStatusResponse> {
  try {
    return await client.getUserContext({ includeContent });
  } catch (error) {
    if (error instanceof NakamaApiError && error.status === 404) {
      return EMPTY_USER_CONTEXT;
    }

    throw error;
  }
}

export function useDeleteToolMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolId: string) => client.deleteTool(toolId),
    onSuccess: async (_data, toolId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tools.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.tools.detail(toolId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.tools.source(toolId),
        }),
      ]);
    },
  });
}

export function useCreateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProfileRequest) => client.createProfile(input),
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.soul.profile(data.profile.id),
        }),
      ]);
    },
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      input,
    }: {
      profileId: string;
      input: UpdateProfileRequest;
    }) => client.updateProfile(profileId, input),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.profiles.detail(variables.profileId),
        }),
      ]);
    },
  });
}

export function useUpdateSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sessionId,
      input,
    }: {
      profileId: string;
      sessionId: string;
      input: UpdateSessionRequest;
      channel?: AgentChannel;
    }) => client.updateSession(sessionId, input),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessions(
          variables.profileId,
          variables.channel ?? "web"
        ),
      });
    },
  });
}
export function useDeleteSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => client.deleteSession(sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useCloneProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileId: string) => client.cloneProfile(profileId),
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.soul.profile(data.profile.id),
        }),
      ]);
    },
  });
}

export function useDeleteProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileId: string) => client.deleteProfile(profileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}

async function invalidateProfileQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  profileId: string
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.profiles.detail(profileId),
    }),
  ]);
}

export function useUploadProfileAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      attachment,
    }: {
      profileId: string;
      attachment: ImageAttachment;
    }) => client.uploadProfileAvatar(profileId, attachment),
    onSuccess: async (_data, variables) => {
      await invalidateProfileQueries(queryClient, variables.profileId);
    },
  });
}

export function useDeleteProfileAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileId: string) => client.deleteProfileAvatar(profileId),
    onSuccess: async (_data, profileId) => {
      await invalidateProfileQueries(queryClient, profileId);
    },
  });
}

export function useAssignToolMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      profileId,
      toolId,
    }: {
      profileId: string;
      toolId: string | string[];
    }) => {
      const results = await Promise.allSettled(
        (Array.isArray(toolId) ? toolId : [toolId]).map((id) =>
          client.assignTool(profileId, { toolId: id })
        )
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") {
        throw failure.reason;
      }
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.profiles.detail(variables.profileId),
        }),
      ]);
    },
  });
}

export function useUnassignToolMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      profileId,
      toolId,
    }: {
      profileId: string;
      toolId: string | string[];
    }) => {
      const results = await Promise.allSettled(
        (Array.isArray(toolId) ? toolId : [toolId]).map((id) =>
          client.unassignTool(profileId, id)
        )
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") {
        throw failure.reason;
      }
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.profiles.detail(variables.profileId),
        }),
      ]);
    },
  });
}

export function useCreateMcpServerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof client.createMcpServer>[0]) =>
      client.createMcpServer(input),
    onSuccess: async (data) => {
      queryClient.setQueryData(
        queryKeys.mcp.detail(data.server.id),
        data.server
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcp.all });
    },
  });
}

export function useUpdateMcpServerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      serverId,
      request,
    }: {
      serverId: string;
      request: Parameters<typeof client.updateMcpServer>[1];
    }) => client.updateMcpServer(serverId, request),
    onSuccess: async (data, { serverId }) => {
      queryClient.setQueryData(queryKeys.mcp.detail(serverId), data.server);
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcp.all });
    },
  });
}

export function useDeleteMcpServerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (serverId: string) => client.deleteMcpServer(serverId),
    onSuccess: async (_data, serverId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mcp.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.mcp.detail(serverId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
      ]);
    },
  });
}

export function useConnectMcpServerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (serverId: string) => client.connectMcpServer(serverId),
    onSuccess: async (data, serverId) => {
      queryClient.setQueryData(queryKeys.mcp.detail(serverId), data.server);
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcp.all });
    },
  });
}

export function useSyncMcpServerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (serverId: string) => client.syncMcpServer(serverId),
    onSuccess: async (data, serverId) => {
      queryClient.setQueryData(queryKeys.mcp.detail(serverId), data.server);
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcp.all });
    },
  });
}

export function useAssignMcpServerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      serverId,
    }: {
      profileId: string;
      serverId: string;
    }) => client.assignMcpServer(profileId, { serverId }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.profiles.detail(variables.profileId),
        }),
      ]);
    },
  });
}

export function useUnassignMcpServerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      serverId,
    }: {
      profileId: string;
      serverId: string;
    }) => client.unassignMcpServer(profileId, serverId),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.profiles.detail(variables.profileId),
        }),
      ]);
    },
  });
}

export function useCreateSkillMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof client.createSkill>[0]) =>
      client.createSkill(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
    },
  });
}

export function useInstallSkillMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof client.installSkill>[0]) =>
      client.installSkill(input),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.skills.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.profiles.detail(variables.profileId),
        }),
      ]);
    },
  });
}

export function usePatchSkillMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      skillId,
      input,
      profileId,
    }: {
      skillId: string;
      input: Parameters<typeof client.patchSkill>[1];
      profileId?: string;
    }) =>
      client.patchSkill(skillId, input, profileId ? { profileId } : undefined),
    onSuccess: async (data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.skills.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.skills.detail(variables.skillId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        ...(variables.profileId
          ? [
              queryClient.invalidateQueries({
                queryKey: queryKeys.profiles.detail(variables.profileId),
              }),
            ]
          : []),
      ]);
      queryClient.setQueryData(
        queryKeys.skills.detail(data.skill.id),
        data.skill
      );
    },
  });
}

export function useDeleteSkillMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (skillId: string) => client.deleteSkill(skillId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.skills.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
      ]);
    },
  });
}

export function useAssignSkillMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      skillId,
    }: {
      profileId: string;
      skillId: string;
    }) => client.assignSkill(profileId, { skillId }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.profiles.detail(variables.profileId),
        }),
      ]);
    },
  });
}

export function useUnassignSkillMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      skillId,
    }: {
      profileId: string;
      skillId: string;
    }) => client.unassignSkill(profileId, skillId),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.profiles.detail(variables.profileId),
        }),
      ]);
    },
  });
}

export function useHistorySessionsQuery(profileId: string) {
  const runningSessionIds = useRunningTurnsStore((state) => state.sessionIds);
  // Turns are only ever started from the web chat page, so the other channels
  // have no reason to poll along with it.
  const localTurn = runningSessionIds.length > 0;

  const results = useQueries({
    queries: HISTORY_SESSION_CHANNELS.map((channel) => ({
      enabled: Boolean(profileId),
      queryFn: async () =>
        (await client.listSessions(profileId, channel)).sessions,
      queryKey: queryKeys.sessions(profileId, channel),
      // A title is written after the turn returns and a turn ends without
      // telling anyone, so the list has to look again. Gated per channel, so a
      // quiet list makes no requests at all.
      refetchInterval: (query: { state: { data?: SessionSummary[] } }) =>
        sessionListPollInterval(query.state.data, {
          localTurn: channel === "web" && localTurn,
        }),
    })),
  });

  const sessions = results
    .flatMap((result) => result.data ?? [])
    // The server answers from its own registry, which this tab can be ahead of
    // for the moment between starting a turn and the list catching up.
    .map((session) =>
      session.active || !runningSessionIds.includes(session.id)
        ? session
        : { ...session, active: true }
    )
    .sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        right.updatedAt.localeCompare(left.updatedAt)
    );

  return {
    data: sessions,
    error: results.find((result) => result.error)?.error ?? null,
    isFetching: results.some((result) => result.isFetching),
    isLoading: results.some((result) => result.isLoading),
    refetch: () => Promise.all(results.map((result) => result.refetch())),
  };
}

export function useSoulStatusQuery(profileId: string | null) {
  return useQuery({
    enabled: Boolean(profileId),
    queryFn: () => client.getProfileSoulStatus(profileId!),
    queryKey: queryKeys.soul.profile(profileId ?? ""),
  });
}

export function useOrganizationKnowledgeBaseQuery(orgId: string | null) {
  return useQuery({
    enabled: Boolean(orgId),
    queryFn: () => client.listOrganizationKnowledgeBase(orgId!),
    queryKey: queryKeys.knowledgeBase.organization(orgId ?? ""),
  });
}

export function useKnowledgeBaseQuery(profileId: string | null) {
  return useQuery({
    enabled: Boolean(profileId),
    queryFn: () => client.listKnowledgeBase(profileId!),
    queryKey: queryKeys.knowledgeBase.profile(profileId ?? ""),
  });
}

const EMPTY_PINNED_FILES: WorkspaceEntry[] = [];

export function useFilePins(profileId: string | null, enabled: boolean) {
  const { activeOrg, user } = useAuth();
  const queryClient = useQueryClient();
  const pins = useQuery({
    enabled: Boolean(enabled && profileId && activeOrg),
    queryFn: () => client.listProfileFilePins(profileId!),
    queryKey: ["file-pins", activeOrg?.id, user?.id, profileId],
  });
  const mutation = useMutation({
    mutationFn: (body: { path: string; pinned: boolean }) =>
      client.setProfileFilePinned(profileId!, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["file-pins"] }),
  });
  const entries = pins.data?.entries ?? EMPTY_PINNED_FILES;
  const pending = pins.isPending || pins.isError || mutation.isPending;
  const { mutate } = mutation;
  const controls = useMemo(
    () => ({
      paths: new Set(entries.map((entry) => entry.path)),
      pending,
      toggle: (path: string, pinned: boolean) => mutate({ path, pinned }),
    }),
    [entries, pending, mutate]
  );
  return { controls, entries, error: pins.error || mutation.error };
}

export function useArtifactsQuery(profileId: string | null, folder = "") {
  return useQuery({
    enabled: Boolean(profileId),
    // ponytail: fetch metadata once; paginate directory entries server-side if listings outgrow this response.
    queryFn: () => client.listProfileArtifacts(profileId!, { folder }),
    queryKey: [
      ...queryKeys.artifacts.profile(profileId ?? ""),
      "listing",
      folder,
    ],
  });
}

export function useWriteArtifactMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      artifactPath,
      content,
    }: {
      profileId: string;
      artifactPath: string;
      content: string;
    }) => client.writeProfileArtifactContent(profileId, artifactPath, content),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.artifacts.profile(variables.profileId),
      });
    },
  });
}

export function useDeleteArtifactMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      filename,
    }: {
      profileId: string;
      filename: string;
    }) => client.deleteProfileArtifact(profileId, filename),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["file-pins"] });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.artifacts.profile(variables.profileId),
      });
    },
  });
}

export function useArtifactShareStatusQuery(
  profileId: string,
  artifactPath: string,
  orgId: string
) {
  return useQuery({
    enabled: Boolean(profileId && artifactPath && orgId),
    queryFn: () =>
      client.getProfileArtifactShareStatus(profileId, artifactPath),
    queryKey: queryKeys.artifacts.shareStatus(profileId, artifactPath),
  });
}

export function usePublishArtifactShareMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ profileId, path }: { profileId: string; path: string }) =>
      client.publishProfileArtifactShare(profileId, path),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.artifacts.shareStatus(
          variables.profileId,
          variables.path
        ),
      });
    },
  });
}

export function useRevokeArtifactShareMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      profileId,
      shareId,
    }: {
      profileId: string;
      shareId: string;
      path?: string;
    }) => {
      try {
        return await client.revokeProfileArtifactShare(profileId, shareId);
      } catch (error) {
        // Another tab may have revoked this link; still clear stale share state.
        if (error instanceof NakamaApiError && error.status === 404) {
          return { id: shareId, revoked: false };
        }
        throw error;
      }
    },
    onSuccess: async (_data, variables) => {
      if (variables.path) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.artifacts.shareStatus(
            variables.profileId,
            variables.path
          ),
        });
      }
    },
  });
}

export function useSoulFileQuery(
  profileId: string | null,
  fileKey: string | null,
  enabled: boolean
) {
  return useQuery({
    enabled: enabled && Boolean(profileId) && Boolean(fileKey),
    queryFn: async () => {
      const response = await client.getProfileSoulStatus(profileId!, {
        includeContents: true,
      });
      return response.contents?.[fileKey as keyof SoulStackFiles] ?? "";
    },
    queryKey: [
      ...queryKeys.soul.profile(profileId ?? ""),
      "file",
      fileKey ?? "",
    ] as const,
  });
}

export function useBranchSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sessionId,
      messageIndex,
    }: {
      profileId: string;
      sessionId: string;
      messageIndex: number;
      channel?: AgentChannel;
    }) => client.branchSession(sessionId, { messageIndex }),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessions(
          variables.profileId,
          variables.channel ?? "web"
        ),
      });
    },
  });
}

export function useWriteSoulFileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      fileKey,
      content,
    }: {
      profileId: string;
      fileKey: keyof SoulStackFiles;
      content: string;
    }) => client.writeProfileSoulFile(profileId, fileKey, content),
    onSuccess: async (_data, variables) => {
      const soulKey = queryKeys.soul.profile(variables.profileId);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: soulKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({
          queryKey: [...soulKey, "file", variables.fileKey],
        }),
      ]);
    },
  });
}

export function useUserContextQuery(
  options: { includeContent?: boolean; orgId?: string | null } = {}
) {
  return useQuery({
    enabled: options.orgId !== null,
    queryFn: () => fetchUserContext(options.includeContent),
    queryKey: [
      ...queryKeys.userContext,
      options.orgId ?? "no-org",
      options.includeContent ? "content" : "status",
    ] as const,
  });
}

export function useWriteUserContextMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (content: string) => client.writeUserContext(content),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.userContext });
    },
  });
}

export function useUploadKnowledgeBaseDocumentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      document,
      onDuplicate,
    }: {
      profileId: string;
      document: DocumentAttachment;
      onDuplicate?: KnowledgeBaseDuplicateAction;
    }) => client.uploadKnowledgeBaseDocument(profileId, document, onDuplicate),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.knowledgeBase.profile(variables.profileId),
      });
    },
  });
}

export function useAttachSharedKnowledgeBaseDocumentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      documentId,
    }: {
      profileId: string;
      documentId: string;
    }) => client.attachSharedKnowledgeBaseDocument(profileId, documentId),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.knowledgeBase.profile(variables.profileId),
      });
    },
  });
}

export function useDetachSharedKnowledgeBaseDocumentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      documentId,
    }: {
      profileId: string;
      documentId: string;
    }) => client.detachSharedKnowledgeBaseDocument(profileId, documentId),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.knowledgeBase.profile(variables.profileId),
      });
    },
  });
}

export function useDeleteKnowledgeBaseDocumentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      documentId,
    }: {
      profileId: string;
      documentId: string;
    }) => client.deleteKnowledgeBaseDocument(profileId, documentId),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.knowledgeBase.profile(variables.profileId),
      });
    },
  });
}
