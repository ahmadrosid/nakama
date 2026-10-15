import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

export function useSkillSuggestions(
  orgId: string | null,
  options: {
    sessionId?: string;
    status?: "pending" | "applied";
    profileId?: string;
    enabled?: boolean;
    refetchInterval?: number | false;
  } = {}
) {
  const status = options.status ?? "pending";

  return useQuery({
    enabled: Boolean(orgId) && (options.enabled ?? true),
    queryFn: () =>
      client.listSkillSuggestions(orgId ?? "", {
        profileId: options.profileId,
        sessionId: options.sessionId,
        status,
      }),
    queryKey: queryKeys.skillSuggestions(orgId ?? "", {
      profileId: options.profileId,
      sessionId: options.sessionId,
      status,
    }),
    refetchInterval: options.refetchInterval,
  });
}

function invalidateSkillSuggestionQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string
) {
  return invalidateQueries(queryClient, ["skillSuggestions", orgId]);
}

export function useApplySkillSuggestion(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (suggestionId: string) =>
      client.applySkillSuggestion(orgId, suggestionId),
    onSuccess: () => {
      void invalidateSkillSuggestionQueries(queryClient, orgId);
      void invalidateQueries(queryClient, ["skillProposals", orgId]);
      void invalidateQueries(queryClient, queryKeys.skills.all);
      void invalidateQueries(queryClient, queryKeys.profiles.all);
    },
  });
}
