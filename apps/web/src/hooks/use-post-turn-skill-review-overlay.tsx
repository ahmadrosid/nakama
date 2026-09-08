import type { AgentChannel, ProfileSummary } from "@nakama/core/contract";
import { resolveProfileOrgBooleanOverride } from "@nakama/core/skills/profile-org-override";
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
import { canAccessSystemPage } from "@/lib/navigation";

const POST_TURN_POLL_WINDOW_MS = 45_000;
const POST_TURN_POLL_INTERVAL_MS = 3000;

/**
 * Which channels the post-turn skill-review overlay polls. Total over
 * `AgentChannel` so a new channel fails the typecheck here rather than
 * silently skipping (#474 / #798).
 *
 * `web` and `cli`: poll — a cli session opens in the web chat route with
 * `sessionChannel === "cli"` (history listing is separate; see #910).
 * telegram/whatsapp/discord: false — read-only in web, so apply is blocked
 * anyway. automation/task/subagent: false — server does not review them.
 */
const POST_TURN_OVERLAY_POLL_CHANNEL = {
  automation: false,
  cli: true,
  discord: false,
  subagent: false,
  task: false,
  telegram: false,
  web: true,
  whatsapp: false,
} as const satisfies Record<AgentChannel, boolean>;

interface UsePostTurnSkillReviewOverlayArgs {
  lastSuccessfulTurnAt: number | null;
  profile: ProfileSummary | undefined;
  readOnlySession: boolean;
  sessionChannel: AgentChannel;
  sessionId: string | null;
}

function canPollPostTurnReview({
  activeOrgId,
  readOnlySession,
  reviewEnabled,
  sessionChannel,
  sessionId,
}: {
  activeOrgId?: string;
  readOnlySession: boolean;
  reviewEnabled: boolean;
  sessionChannel: AgentChannel;
  sessionId: string | null;
}): boolean {
  return (
    reviewEnabled &&
    Boolean(activeOrgId) &&
    Boolean(sessionId) &&
    POST_TURN_OVERLAY_POLL_CHANNEL[sessionChannel] &&
    !readOnlySession
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

function useSkillSuggestionApply(orgId: string | undefined) {
  const applyMutation = useApplySkillSuggestion(orgId ?? "");
  const [applyStateById, setApplyStateById] = useState<
    Record<string, SuggestionApplyState>
  >({});
  const [applyErrorById, setApplyErrorById] = useState<
    Record<string, string | undefined>
  >({});

  async function handleApply(
    suggestionId: string,
    onApplied: () => void
  ): Promise<void> {
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

  return { applyErrorById, applyStateById, handleApply };
}

export function usePostTurnSkillReviewOverlay({
  sessionId,
  profile,
  sessionChannel,
  lastSuccessfulTurnAt,
  readOnlySession,
}: UsePostTurnSkillReviewOverlayArgs) {
  const { activeOrg, user } = useAuth();
  const reviewEnabled = resolveProfileOrgBooleanOverride(
    profile?.skillsPostTurnReview ?? null,
    activeOrg?.skillsPostTurnReview ?? false
  );
  const canReview = canAccessSystemPage(
    user?.isPlatformAdmin === true,
    activeOrg?.role
  );
  const canPoll =
    canReview &&
    canPollPostTurnReview({
      activeOrgId: activeOrg?.id,
      readOnlySession,
      reviewEnabled,
      sessionChannel,
      sessionId,
    });
  const polling = usePostTurnPolling(canPoll, lastSuccessfulTurnAt);
  const pollQuery = {
    enabled: canPoll,
    refetchInterval: (polling ? POST_TURN_POLL_INTERVAL_MS : false) as
      | number
      | false,
    sessionId: sessionId ?? undefined,
    status: "pending" as const,
  };
  const orgId = canPoll ? (activeOrg?.id ?? null) : null;
  const suggestionsQuery = useSkillSuggestions(orgId, pollQuery);
  const proposalsQuery = useSkillProposals(orgId, pollQuery);
  const { applyErrorById, applyStateById, handleApply } =
    useSkillSuggestionApply(activeOrg?.id);
  const suggestions = suggestionsQuery.data?.suggestions ?? [];
  const pendingProposals = useMemo(
    () =>
      (proposalsQuery.data?.proposals ?? []).filter(
        (proposal) =>
          proposal.sessionId === sessionId && proposal.status === "pending"
      ),
    [proposalsQuery.data?.proposals, sessionId]
  );
  const [dismissedIds, setDismissedIds] = useState<readonly string[]>([]);
  const dismissed = new Set(dismissedIds);
  const visibleSuggestions = suggestions.filter(
    (suggestion) => !dismissed.has(`${sessionId}:suggestion:${suggestion.id}`)
  );
  const visibleProposals = pendingProposals.filter(
    (proposal) => !dismissed.has(`${sessionId}:proposal:${proposal.id}`)
  );
  const showBanner =
    canPoll && (visibleSuggestions.length > 0 || visibleProposals.length > 0);

  const banner = showBanner ? (
    <SkillPostTurnReviewBanner
      applyErrorById={applyErrorById}
      applyStateById={applyStateById}
      onApply={(id) =>
        void handleApply(id, () => {
          void suggestionsQuery.refetch();
          void proposalsQuery.refetch();
        })
      }
      onDismiss={(id) => {
        if (!sessionId) {
          return;
        }
        setDismissedIds((current) =>
          current.includes(`${sessionId}:${id}`)
            ? current
            : [...current, `${sessionId}:${id}`]
        );
      }}
      pendingProposals={visibleProposals}
      suggestions={visibleSuggestions}
    />
  ) : null;

  return { banner, reviewEnabled };
}
