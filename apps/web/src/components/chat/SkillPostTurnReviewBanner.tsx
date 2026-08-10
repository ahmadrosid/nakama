import type { SkillProposal, SkillSuggestion } from "@nakama/core/contract";
import { Link } from "react-router-dom";
import { skillSuggestionPreview } from "@/components/chat/skill-post-turn-review.shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { orgSkillProposalsPath } from "@/lib/navigation";

export type SuggestionApplyState =
  | "idle"
  | "loading"
  | "applied"
  | "staged"
  | "error";

interface SkillPostTurnReviewBannerProps {
  applyErrorById: Record<string, string | undefined>;
  applyStateById: Record<string, SuggestionApplyState>;
  canApply: boolean;
  isOrgAdmin: boolean;
  onApply: (suggestionId: string) => void;
  pendingProposals: SkillProposal[];
  suggestions: SkillSuggestion[];
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
    <div
      className="mb-3 flex flex-col gap-2"
      data-testid="skill-post-turn-review-banner"
    >
      {pendingProposals.map((proposal) => (
        <div
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
          key={proposal.id}
        >
          <p className="font-medium text-foreground">
            Skill {proposal.action} “{proposal.skillName}” pending admin review
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            Post-turn review staged this change. It will not go live until an
            org admin approves it.
          </p>
          {isOrgAdmin ? (
            <p className="mt-2 text-xs">
              <Link
                className="underline underline-offset-2 hover:text-foreground"
                to={orgSkillProposalsPath(proposal.profileId)}
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
            className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
            key={suggestion.id}
          >
            <p className="font-medium text-foreground">{preview.title}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {preview.description}
            </p>
            {preview.excerpt ? (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background/70 p-2 font-mono text-[11px] text-foreground leading-relaxed">
                {preview.excerpt}
              </pre>
            ) : null}
            {suggestion.warnings && suggestion.warnings.length > 0 ? (
              <p className="mt-2 text-amber-600 text-xs dark:text-amber-400">
                {suggestion.warnings.join(" ")}
              </p>
            ) : null}
            {error ? (
              <p className="mt-2 text-destructive text-xs">{error}</p>
            ) : null}
            {state === "staged" ? (
              <p className="mt-2 text-muted-foreground text-xs">
                Write approval is on — staged for admin review instead of
                writing immediately.
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <Button
                disabled={!canApply || applied || loading}
                onClick={() => onApply(suggestion.id)}
                size="sm"
                type="button"
              >
                {loading ? <Spinner className="mr-2" /> : null}
                {applied
                  ? state === "staged"
                    ? "Staged"
                    : "Applied"
                  : "Apply"}
              </Button>
              {canApply ? null : (
                <span className="text-muted-foreground text-xs">
                  Viewers cannot apply.
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
