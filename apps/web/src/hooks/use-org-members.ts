import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AddOrgMemberRequest,
  InviteOrgMemberRequest,
  OrgRole,
} from "@tinyclaw/core/contract";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function orgMembersQueryOptions(orgId: string) {
  return queryOptions({
    queryKey: queryKeys.orgMembers(orgId),
    queryFn: () => client.listOrgMembers(orgId),
  });
}

export function useOrgMembers(orgId: string | null) {
  return useQuery({
    ...orgMembersQueryOptions(orgId ?? ""),
    enabled: Boolean(orgId),
  });
}

function invalidateOrgMembers(queryClient: ReturnType<typeof useQueryClient>, orgId: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.orgMembers(orgId) });
}

export function useInviteOrgMember(orgId: string) {
  return useMutation({
    mutationFn: (request: InviteOrgMemberRequest) => client.inviteOrgMember(orgId, request),
  });
}

export function useAddOrgMember(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: AddOrgMemberRequest) => client.addOrgMember(orgId, request),
    onSuccess: () => invalidateOrgMembers(queryClient, orgId),
  });
}

export function useUpdateOrgMemberRole(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      client.updateOrgMemberRole(orgId, userId, { role }),
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
