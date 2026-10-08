import type { ApproveOrgMemoryProposalRequest } from "@nakama/core/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

export function useOrgMemoryProposals(
  orgId: string | null,
  status: "pending" | "approved" | "rejected" = "pending",
  options?: { refetchInterval?: number }
) {
  return useQuery({
    enabled: Boolean(orgId),
    queryFn: () => client.listOrgMemoryProposals(orgId ?? "", status),
    queryKey: queryKeys.orgMemoryProposals(orgId ?? "", status),
    refetchInterval: options?.refetchInterval,
  });
}

function invalidateProposalQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string
) {
  return invalidateQueries(
    queryClient,
    ["orgMemoryProposals", orgId],
    queryKeys.orgMemory(orgId),
    queryKeys.orgMemoryHistory(orgId)
  );
}

export function useApproveOrgMemoryProposal(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      proposalId,
      request = {},
    }: {
      proposalId: string;
      request?: ApproveOrgMemoryProposalRequest;
    }) => client.approveOrgMemoryProposal(orgId, proposalId, request),
    onSuccess: () => invalidateProposalQueries(queryClient, orgId),
  });
}

export function useRejectOrgMemoryProposal(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (proposalId: string) =>
      client.rejectOrgMemoryProposal(orgId, proposalId),
    onSuccess: () => invalidateProposalQueries(queryClient, orgId),
  });
}
