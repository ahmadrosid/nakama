import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentChannel,
  CreateProfileRequest,
  ImageAttachment,
  SoulStackFiles,
  UpdateProfileRequest,
} from "@tinyclaw/core/contract";
import { client } from "@/lib/client";
import { profileQueryOptions } from "@/hooks/use-app-queries";
import { queryKeys } from "@/lib/query-keys";

export function useDeleteToolMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolId: string) => client.deleteTool(toolId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tools.all });
    },
  });
}

export function useCreateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProfileRequest) => client.createProfile(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
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

export function useInitProfileSoulMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileId: string) => client.initProfileSoul(profileId),
    onSuccess: async (_data, profileId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(profileId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.soul.profile(profileId) }),
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

export function useInvalidateSessions() {
  const queryClient = useQueryClient();

  return (profileId: string, channel: AgentChannel = "web") =>
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions(profileId, channel) });
}

export function useSoulStatusQuery(scope: "global" | string) {
  return useQuery({
    queryKey: scope === "global" ? queryKeys.soul.global : queryKeys.soul.profile(scope),
    queryFn: () =>
      scope === "global" ? client.getSoulStatus() : client.getProfileSoulStatus(scope),
    enabled: scope === "global" || Boolean(scope),
  });
}

export function useSoulFileQuery(
  scope: "global" | string,
  fileKey: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey:
      scope === "global"
        ? [...queryKeys.soul.global, "file", fileKey ?? ""]
        : [...queryKeys.soul.profile(scope), "file", fileKey ?? ""],
    queryFn: async () => {
      const response =
        scope === "global"
          ? await client.getSoulStatus({ includeContents: true })
          : await client.getProfileSoulStatus(scope, { includeContents: true });

      return response.contents?.[fileKey as keyof SoulStackFiles] ?? "";
    },
    enabled: enabled && Boolean(fileKey),
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

export function useInitSoulMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.initSoul(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.soul.global }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all }),
      ]);
    },
  });
}

export function useWriteSoulFileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      scope,
      fileKey,
      content,
    }: {
      scope: "global" | string;
      fileKey: keyof SoulStackFiles;
      content: string;
    }) =>
      scope === "global"
        ? client.writeSoulFile(fileKey, content)
        : client.writeProfileSoulFile(scope, fileKey, content),
    onSuccess: async (_data, variables) => {
      const soulKey =
        variables.scope === "global"
          ? queryKeys.soul.global
          : queryKeys.soul.profile(variables.scope);

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

export { profileQueryOptions };
