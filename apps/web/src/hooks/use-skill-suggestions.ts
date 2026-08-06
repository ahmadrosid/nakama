import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useSkillSuggestions(
  orgId: string | null,
  options: {
    sessionId?: string;
    status?: "pending" | "applied";
    profileId?: string;
    enabled?: boolean;
    refetchInterval?: number | false;
  } = {},
) {
  const status = options.status ?? "pending";
  return useQuery({
    queryKey: queryKeys.skillSuggestions(orgId ?? "", {
      status,
      sessionId: options.sessionId,
      profileId: options.profileId,
    }),
    queryFn: () =>
      client.listSkillSuggestions(orgId ?? "", {
        status,
        sessionId: options.sessionId,
        profileId: options.profileId,
      }),
    enabled: Boolean(orgId) && (options.enabled ?? true),
    refetchInterval: options.refetchInterval,
  });
}

function invalidateSkillSuggestionQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string,
) {
  return queryClient.invalidateQueries({ queryKey: ["skillSuggestions", orgId] });
}

export function useApplySkillSuggestion(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) => client.applySkillSuggestion(orgId, suggestionId),
    onSuccess: () => {
      void invalidateSkillSuggestionQueries(queryClient, orgId);
      void queryClient.invalidateQueries({ queryKey: ["skillProposals", orgId] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}
