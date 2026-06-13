import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentChannel,
  CreateProfileRequest,
  DocumentAttachment,
  ImageAttachment,
  SoulStackFiles,
  UpdateProfileRequest,
  UserContextStatusResponse,
} from "@tinyclaw/core/contract";
import { TinyClawApiError } from "@tinyclaw/core/api-error";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const EMPTY_USER_CONTEXT: UserContextStatusResponse = {
  path: "",
  active: false,
};

async function fetchUserContext(
  includeContent?: boolean,
): Promise<UserContextStatusResponse> {
  try {
    return await client.getUserContext({ includeContent });
  } catch (error) {
    if (error instanceof TinyClawApiError && error.status === 404) {
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
        queryClient.invalidateQueries({ queryKey: queryKeys.tools.detail(toolId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tools.source(toolId) }),
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
  profileId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(profileId) }),
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
    mutationFn: ({ profileId, toolId }: { profileId: string; toolId: string }) =>
      client.assignTool(profileId, { toolId }),
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

export function useUnassignToolMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ profileId, toolId }: { profileId: string; toolId: string }) =>
      client.unassignTool(profileId, toolId),
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

export function useCreateMcpServerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<typeof client.createMcpServer>[0]) =>
      client.createMcpServer(input),
    onSuccess: async (data) => {
      queryClient.setQueryData(queryKeys.mcp.detail(data.server.id), data.server);
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
        queryClient.invalidateQueries({ queryKey: queryKeys.mcp.detail(serverId) }),
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
    mutationFn: ({ profileId, serverId }: { profileId: string; serverId: string }) =>
      client.assignMcpServer(profileId, { serverId }),
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
    mutationFn: ({ profileId, serverId }: { profileId: string; serverId: string }) =>
      client.unassignMcpServer(profileId, serverId),
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
    mutationFn: (input: Parameters<typeof client.createSkill>[0]) => client.createSkill(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
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

export function useSyncSkillsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.syncSkills(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
    },
  });
}

export function useAssignSkillMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ profileId, skillId }: { profileId: string; skillId: string }) =>
      client.assignSkill(profileId, { skillId }),
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
    mutationFn: ({ profileId, skillId }: { profileId: string; skillId: string }) =>
      client.unassignSkill(profileId, skillId),
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

export function useSessionsQuery(profileId: string, channel: AgentChannel = "web") {
  return useQuery({
    queryKey: queryKeys.sessions(profileId, channel),
    queryFn: async () => (await client.listSessions(profileId, channel)).sessions,
    enabled: Boolean(profileId),
  });
}

export function useSoulStatusQuery(profileId: string | null) {
  return useQuery({
    queryKey: queryKeys.soul.profile(profileId ?? ""),
    queryFn: () => client.getProfileSoulStatus(profileId!),
    enabled: Boolean(profileId),
  });
}

export function useKnowledgeBaseQuery(profileId: string | null) {
  return useQuery({
    queryKey: queryKeys.knowledgeBase.profile(profileId ?? ""),
    queryFn: () => client.listKnowledgeBase(profileId!),
    enabled: Boolean(profileId),
  });
}

export function useSoulFileQuery(
  profileId: string | null,
  fileKey: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...queryKeys.soul.profile(profileId ?? ""), "file", fileKey ?? ""] as const,
    queryFn: async () => {
      const response = await client.getProfileSoulStatus(profileId!, { includeContents: true });
      return response.contents?.[fileKey as keyof SoulStackFiles] ?? "";
    },
    enabled: enabled && Boolean(profileId) && Boolean(fileKey),
  });
}

export function usePurgeSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sessionId,
      channel = "web",
    }: {
      profileId: string;
      sessionId: string;
      channel?: AgentChannel;
    }) => client.createChatSession(sessionId, channel).purge(),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sessions(variables.profileId, variables.channel ?? "web"),
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

export function useUserContextQuery(options: { includeContent?: boolean } = {}) {
  return useQuery({
    queryKey: [...queryKeys.userContext, options.includeContent ? "content" : "status"] as const,
    queryFn: () => fetchUserContext(options.includeContent),
  });
}

export function useInitUserContextMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.initUserContext(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.userContext });
    },
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
    }: {
      profileId: string;
      document: DocumentAttachment;
    }) => client.uploadKnowledgeBaseDocument(profileId, document),
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
