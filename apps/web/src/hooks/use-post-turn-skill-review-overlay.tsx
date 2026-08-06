import { useEffect, useMemo, useState } from "react";
import type { AgentChannel, ProfileSummary } from "@nakama/core/contract";
import { resolveSkillPostTurnReviewEnabled } from "@nakama/core/skills/post-turn-review";
import {
  SkillPostTurnReviewBanner,
  type SuggestionApplyState,
} from "@/components/chat/SkillPostTurnReviewBanner";
import { useAuth } from "@/context/use-auth";
import { useApplySkillSuggestion, useSkillSuggestions } from "@/hooks/use-skill-suggestions";
import { useSkillProposals } from "@/hooks/use-skill-proposals";
import { formatError } from "@/lib/client";

const POST_TURN_POLL_WINDOW_MS = 45_000;
const POST_TURN_POLL_INTERVAL_MS = 3_000;

interface UsePostTurnSkillReviewOverlayArgs {
  sessionId: string | null;
  profile: ProfileSummary | undefined;
  sessionChannel: AgentChannel;
  lastSuccessfulTurnAt: number | null;
  readOnlySession: boolean;
}

export function usePostTurnSkillReviewOverlay({
  sessionId,
  profile,
  sessionChannel,
  lastSuccessfulTurnAt,
  readOnlySession,
}: UsePostTurnSkillReviewOverlayArgs) {
  const { activeOrg } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const [applyStateById, setApplyStateById] = useState<Record<string, SuggestionApplyState>>({});
  const [applyErrorById, setApplyErrorById] = useState<Record<string, string | undefined>>({});

  const reviewEnabled = resolveSkillPostTurnReviewEnabled({
    orgSkillsPostTurnReview: activeOrg?.skillsPostTurnReview ?? false,
    profileSkillsPostTurnReview: profile?.skillsPostTurnReview ?? null,
  });

  const canPoll =
    reviewEnabled &&
    Boolean(activeOrg?.id) &&
    Boolean(sessionId) &&
    sessionChannel === "web" &&
    !readOnlySession &&
    activeOrg?.role !== "viewer";

  const pollUntil =
    lastSuccessfulTurnAt != null && canPoll
      ? lastSuccessfulTurnAt + POST_TURN_POLL_WINDOW_MS
      : null;

  const polling = pollUntil != null && now < pollUntil;

  useEffect(() => {
    if (!polling) {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [polling]);

  const suggestionsQuery = useSkillSuggestions(canPoll ? (activeOrg?.id ?? null) : null, {
    sessionId: sessionId ?? undefined,
    status: "pending",
    enabled: canPoll,
    refetchInterval: polling ? POST_TURN_POLL_INTERVAL_MS : false,
  });

  const proposalsQuery = useSkillProposals(canPoll ? (activeOrg?.id ?? null) : null, {
    status: "pending",
    sessionId: sessionId ?? undefined,
    enabled: canPoll,
    refetchInterval: polling ? POST_TURN_POLL_INTERVAL_MS : false,
  });

  const applyMutation = useApplySkillSuggestion(activeOrg?.id ?? "");

  const suggestions = suggestionsQuery.data?.suggestions ?? [];
  const pendingProposals = useMemo(
    () =>
      (proposalsQuery.data?.proposals ?? []).filter(
        (proposal) => proposal.sessionId === sessionId && proposal.status === "pending",
      ),
    [proposalsQuery.data?.proposals, sessionId],
  );

  async function handleApply(suggestionId: string) {
    if (!activeOrg?.id) {
      return;
    }
    setApplyStateById((current) => ({ ...current, [suggestionId]: "loading" }));
    setApplyErrorById((current) => ({ ...current, [suggestionId]: undefined }));
    try {
      const result = await applyMutation.mutateAsync(suggestionId);
      setApplyStateById((current) => ({
        ...current,
        [suggestionId]: result.outcome === "staged_as_proposal" ? "staged" : "applied",
      }));
      void suggestionsQuery.refetch();
      void proposalsQuery.refetch();
    } catch (error) {
      setApplyStateById((current) => ({ ...current, [suggestionId]: "error" }));
      setApplyErrorById((current) => ({
        ...current,
        [suggestionId]: formatError(error),
      }));
    }
  }

  const banner =
    canPoll && (suggestions.length > 0 || pendingProposals.length > 0) ? (
      <SkillPostTurnReviewBanner
        suggestions={suggestions}
        pendingProposals={pendingProposals}
        applyStateById={applyStateById}
        applyErrorById={applyErrorById}
        canApply={activeOrg?.role !== "viewer"}
        isOrgAdmin={activeOrg?.role === "admin"}
        onApply={(id) => void handleApply(id)}
      />
    ) : null;

  return { banner, reviewEnabled };
}
