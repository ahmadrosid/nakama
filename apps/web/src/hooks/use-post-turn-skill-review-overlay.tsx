import type { AgentChannel, ProfileSummary } from "@nakama/core/contract";
import { resolveSkillPostTurnReviewEnabled } from "@nakama/core/skills/profile-org-override";
import { useEffect, useMemo, useState } from "react";
import {
  SkillPostTurnReviewBanner,
  type SuggestionApplyState,
} from "@/components/chat/SkillPostTurnReviewBanner";
import { useAuth } from "@/context/use-auth";
import { useSkillProposals } from "@/hooks/use-skill-proposals";
import {
  useApplySkillSuggestion,
  useSkillSuggestions,
} from "@/hooks/use-skill-suggestions";
import { formatError } from "@/lib/client";

const POST_TURN_POLL_WINDOW_MS = 45_000;
const POST_TURN_POLL_INTERVAL_MS = 3000;

interface UsePostTurnSkillReviewOverlayArgs {
  lastSuccessfulTurnAt: number | null;
  profile: ProfileSummary | undefined;
  readOnlySession: boolean;
  sessionChannel: AgentChannel;
  sessionId: string | null;
}

function resolvePostTurnCanPoll({
  reviewEnabled,
  orgId,
  orgRole,
  sessionId,
  sessionChannel,
  readOnlySession,
}: {
  reviewEnabled: boolean;
  orgId: string | undefined;
  orgRole: string | undefined;
  sessionId: string | null;
  sessionChannel: AgentChannel;
  readOnlySession: boolean;
}): boolean {
  return (
    reviewEnabled &&
    Boolean(orgId) &&
    Boolean(sessionId) &&
    sessionChannel === "web" &&
    !readOnlySession &&
    orgRole !== "viewer"
  );
}

function usePostTurnPolling(
  canPoll: boolean,
  lastSuccessfulTurnAt: number | null
): boolean {
  const [now, setNow] = useState(() => Date.now());
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
    }, 1000);
    return () => window.clearInterval(timer);
  }, [polling]);

  return polling;
}

function PostTurnReviewBannerSlot({
  orgId,
  orgRole,
  canPoll,
  suggestions,
  pendingProposals,
  onApplied,
}: {
  orgId: string | undefined;
  orgRole: string | undefined;
  canPoll: boolean;
  suggestions: NonNullable<
    ReturnType<typeof useSkillSuggestions>["data"]
  >["suggestions"];
  pendingProposals: NonNullable<
    ReturnType<typeof useSkillProposals>["data"]
  >["proposals"];
  onApplied: () => void;
}) {
  const [applyStateById, setApplyStateById] = useState<
    Record<string, SuggestionApplyState>
  >({});
  const [applyErrorById, setApplyErrorById] = useState<
    Record<string, string | undefined>
  >({});
  const applyMutation = useApplySkillSuggestion(orgId ?? "");

  async function handleApply(suggestionId: string) {
    if (!orgId) {
      return;
    }
    setApplyStateById((current) => ({ ...current, [suggestionId]: "loading" }));
    setApplyErrorById((current) => ({ ...current, [suggestionId]: undefined }));
    try {
      const result = await applyMutation.mutateAsync(suggestionId);
      setApplyStateById((current) => ({
        ...current,
        [suggestionId]:
          result.outcome === "staged_as_proposal" ? "staged" : "applied",
      }));
      onApplied();
    } catch (error) {
      setApplyStateById((current) => ({ ...current, [suggestionId]: "error" }));
      setApplyErrorById((current) => ({
        ...current,
        [suggestionId]: formatError(error),
      }));
    }
  }

  if (!(canPoll && (suggestions.length > 0 || pendingProposals.length > 0))) {
    return null;
  }

  return (
    <SkillPostTurnReviewBanner
      applyErrorById={applyErrorById}
      applyStateById={applyStateById}
      canApply={orgRole !== "viewer"}
      isOrgAdmin={orgRole === "admin"}
      onApply={(id) => void handleApply(id)}
      pendingProposals={pendingProposals}
      suggestions={suggestions}
    />
  );
}

export function usePostTurnSkillReviewOverlay({
  sessionId,
  profile,
  sessionChannel,
  lastSuccessfulTurnAt,
  readOnlySession,
}: UsePostTurnSkillReviewOverlayArgs) {
  const { activeOrg } = useAuth();

  const reviewEnabled = resolveSkillPostTurnReviewEnabled({
    orgSkillsPostTurnReview: activeOrg?.skillsPostTurnReview ?? false,
    profileSkillsPostTurnReview: profile?.skillsPostTurnReview ?? null,
  });

  const canPoll = resolvePostTurnCanPoll({
    orgId: activeOrg?.id,
    orgRole: activeOrg?.role,
    readOnlySession,
    reviewEnabled,
    sessionChannel,
    sessionId,
  });

  const polling = usePostTurnPolling(canPoll, lastSuccessfulTurnAt);

  const suggestionsQuery = useSkillSuggestions(
    canPoll ? (activeOrg?.id ?? null) : null,
    {
      enabled: canPoll,
      refetchInterval: polling ? POST_TURN_POLL_INTERVAL_MS : false,
      sessionId: sessionId ?? undefined,
      status: "pending",
    }
  );

  const proposalsQuery = useSkillProposals(
    canPoll ? (activeOrg?.id ?? null) : null,
    {
      enabled: canPoll,
      refetchInterval: polling ? POST_TURN_POLL_INTERVAL_MS : false,
      sessionId: sessionId ?? undefined,
      status: "pending",
    }
  );

  const suggestions = suggestionsQuery.data?.suggestions ?? [];
  const pendingProposals = useMemo(
    () =>
      (proposalsQuery.data?.proposals ?? []).filter(
        (proposal) =>
          proposal.sessionId === sessionId && proposal.status === "pending"
      ),
    [proposalsQuery.data?.proposals, sessionId]
  );

  const banner = (
    <PostTurnReviewBannerSlot
      canPoll={canPoll}
      onApplied={() => {
        void suggestionsQuery.refetch();
        void proposalsQuery.refetch();
      }}
      orgId={activeOrg?.id}
      orgRole={activeOrg?.role}
      pendingProposals={pendingProposals}
      suggestions={suggestions}
    />
  );

  return { banner, reviewEnabled };
}
