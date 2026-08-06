import { Link } from "react-router-dom";
import type { SkillProposal, SkillSuggestion } from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { skillSuggestionPreview } from "@/components/chat/skill-post-turn-review.shared";
import { orgSkillProposalsPath } from "@/lib/navigation";

export type SuggestionApplyState = "idle" | "loading" | "applied" | "staged" | "error";

interface SkillPostTurnReviewBannerProps {
  suggestions: SkillSuggestion[];
  pendingProposals: SkillProposal[];
  applyStateById: Record<string, SuggestionApplyState>;
  applyErrorById: Record<string, string | undefined>;
  canApply: boolean;
  isOrgAdmin: boolean;
  onApply: (suggestionId: string) => void;
}

export function SkillPostTurnReviewBanner({
  suggestions,
  pendingProposals,
  applyStateById,
  applyErrorById,
  canApply,
  isOrgAdmin,
  onApply,
}: SkillPostTurnReviewBannerProps) {
  if (suggestions.length === 0 && pendingProposals.length === 0) {
    return null;
  }

  return (
    <div className="mb-3 flex flex-col gap-2" data-testid="skill-post-turn-review-banner">
      {pendingProposals.map((proposal) => (
        <div
          key={proposal.id}
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
        >
          <p className="font-medium text-foreground">
            Skill {proposal.action} “{proposal.skillName}” pending admin review
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Post-turn review staged this change. It will not go live until an org admin approves it.
          </p>
          {isOrgAdmin ? (
            <p className="mt-2 text-xs">
              <Link
                to={orgSkillProposalsPath(proposal.profileId)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Review proposals
              </Link>
            </p>
          ) : null}
        </div>
      ))}

      {suggestions.map((suggestion) => {
        const preview = skillSuggestionPreview(suggestion);
        const state = applyStateById[suggestion.id] ?? "idle";
        const error = applyErrorById[suggestion.id];
        const applied = state === "applied" || state === "staged";
        const loading = state === "loading";

        return (
          <div
            key={suggestion.id}
            className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
          >
            <p className="font-medium text-foreground">{preview.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{preview.description}</p>
            {preview.excerpt ? (
              <pre className="mt-2 max-h-32 overflow-auto rounded-md border border-border/70 bg-background/70 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground">
                {preview.excerpt}
              </pre>
            ) : null}
            {suggestion.warnings && suggestion.warnings.length > 0 ? (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                {suggestion.warnings.join(" ")}
              </p>
            ) : null}
            {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
            {state === "staged" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Write approval is on — staged for admin review instead of writing immediately.
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!canApply || applied || loading}
                onClick={() => onApply(suggestion.id)}
              >
                {loading ? <Spinner className="mr-2" /> : null}
                {applied ? (state === "staged" ? "Staged" : "Applied") : "Apply"}
              </Button>
              {!canApply ? (
                <span className="text-xs text-muted-foreground">Viewers cannot apply.</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
