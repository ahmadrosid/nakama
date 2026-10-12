import type {
  AddOrgMemberRequest,
  CreateTeamRequest,
  InviteOrgMemberRequest,
  PublishOrgSharedResourceRequest,
  UpdateOrgMemberRequest,
} from "@nakama/core/contract";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

function orgMembersQueryOptions(orgId: string) {
  return queryOptions({
    queryFn: () => client.listOrgMembers(orgId),
    queryKey: queryKeys.orgMembers(orgId),
  });
}

export function useOrganizationOverview(
  orgId: string | null,
  parentOrgId: string | null
) {
  return useQuery({
    enabled: Boolean(orgId),
    queryFn: () => client.getOrganizationOverview(orgId ?? ""),
    queryKey: queryKeys.organizationOverview(
      parentOrgId ?? orgId ?? "",
      orgId ?? ""
    ),
  });
}

export function useOrgMembers(orgId: string | null) {
  return useQuery({
    ...orgMembersQueryOptions(orgId ?? ""),
    enabled: Boolean(orgId),
  });
}

export function useParentOrgMembers(orgId: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: () => client.listParentOrgMembers(orgId),
    queryKey: queryKeys.orgParentMembers(orgId),
  });
}

export function useCreateTeam(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateTeamRequest) =>
      client.createTeam(orgId, request),
    onSuccess: () =>
      invalidateQueries(
        queryClient,
        queryKeys.organizationOverview(orgId, orgId)
      ),
  });
}

export function useOrgPublicationMutation(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      request:
        | { action: "publish"; resource: PublishOrgSharedResourceRequest }
        | { action: "unpublish"; publicationId: string }
    ) => {
      if (request.action === "unpublish") {
        await client.unpublishOrgSharedResource(orgId, request.publicationId);

        return;
      }

      return await client.publishOrgSharedResource(orgId, request.resource);
    },
    onSuccess: () =>
      invalidateQueries(
        queryClient,
        ["organizationOverview", orgId],
        ["organizationPublicationCatalog", orgId],
        ["knowledgeBase"],
        queryKeys.skills.all,
        queryKeys.tools.all,
        queryKeys.models,
        queryKeys.profiles.all
      ),
  });
}

function invalidateOrgMembers(
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string
) {
  return invalidateQueries(queryClient, queryKeys.orgMembers(orgId), [
    "organizationOverview",
  ]);
}

export function useInviteOrgMember(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: InviteOrgMemberRequest) =>
      client.inviteOrgMember(orgId, request),
    onSuccess: () => invalidateOrgMembers(queryClient, orgId),
  });
}

export function useAddOrgMember(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: AddOrgMemberRequest) =>
      client.addOrgMember(orgId, request),
    onSuccess: () => invalidateOrgMembers(queryClient, orgId),
  });
}

export function useUpdateOrgMember(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      request,
    }: {
      userId: string;
      request: UpdateOrgMemberRequest;
    }) => client.updateOrgMember(orgId, userId, request),
    onSuccess: () => invalidateOrgMembers(queryClient, orgId),
  });
}

export function useRemoveOrgMember(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => client.removeOrgMember(orgId, userId),
    onSuccess: () => invalidateOrgMembers(queryClient, orgId),
  });
}
