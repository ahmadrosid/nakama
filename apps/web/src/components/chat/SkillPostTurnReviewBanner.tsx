import type { SkillProposal, SkillSuggestion } from "@nakama/core/contract";
import { Cancel01Icon, QuillWrite02Icon } from "hugeicons-react";
import { Link } from "react-router-dom";
import { ChatComposerNotice } from "@/components/chat/chat-tips";
import { skillSuggestionPreview } from "@/components/chat/skill-post-turn-review.shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { orgSkillProposalsPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

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
  onDismiss: (id: string) => void;
  pendingProposals: SkillProposal[];
  suggestions: SkillSuggestion[];
}

function DismissButton({
  className,
  label,
  onDismiss,
}: {
  className?: string;
  label: string;
  onDismiss: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className={cn(
        "relative text-muted-foreground after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2 hover:text-foreground active:scale-[0.96]",
        className
      )}
      onClick={onDismiss}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <Cancel01Icon strokeWidth={1.5} />
    </Button>
  );
}

const PENDING_PROPOSAL_REASON =
  "Makes the agent smarter for you. Needs admin approval to go live.";

function proposalTitle(proposal: SkillProposal): string {
  const action = proposal.action.replaceAll("_", " ");
  return `${action.charAt(0).toUpperCase()}${action.slice(1)} “${proposal.skillName}”`;
}

function PendingProposalRow({
  isOrgAdmin,
  onDismiss,
  proposal,
}: {
  isOrgAdmin: boolean;
  onDismiss: () => void;
  proposal: SkillProposal;
}) {
  return (
    <div className="text-sm">
      <div className="flex items-center gap-2">
        <QuillWrite02Icon
          aria-hidden
          className="size-3.5 shrink-0"
          strokeWidth={1.5}
        />
        <p className="min-w-0 flex-1 truncate font-medium text-foreground">
          {proposalTitle(proposal)}
        </p>
        <div className="flex shrink-0 items-center">
          {isOrgAdmin ? (
            <Link
              className="px-1.5 text-xs underline underline-offset-2 hover:text-foreground"
              to={orgSkillProposalsPath(proposal.profileId)}
            >
              Review
            </Link>
          ) : null}
          <DismissButton
            label={`Dismiss skill ${proposal.action} ${proposal.skillName}`}
            onDismiss={onDismiss}
          />
        </div>
      </div>
      <p className="mt-0.5 text-pretty pl-[1.375rem] text-muted-foreground text-xs leading-tight">
        {PENDING_PROPOSAL_REASON}
      </p>
    </div>
  );
}

export function SkillPostTurnReviewBanner({
  suggestions,
  pendingProposals,
  applyStateById,
  applyErrorById,
  canApply,
  isOrgAdmin,
  onApply,
  onDismiss,
}: SkillPostTurnReviewBannerProps) {
  if (suggestions.length === 0 && pendingProposals.length === 0) {
    return null;
  }

  return (
    <ChatComposerNotice className="py-1.5">
      <div
        className="flex flex-col divide-y divide-border"
        data-testid="skill-post-turn-review-banner"
      >
        {pendingProposals.map((proposal) => (
          <PendingProposalRow
            isOrgAdmin={isOrgAdmin}
            key={proposal.id}
            onDismiss={() => onDismiss(`proposal:${proposal.id}`)}
            proposal={proposal}
          />
        ))}

        {suggestions.map((suggestion) => {
          const preview = skillSuggestionPreview(suggestion);
          const state = applyStateById[suggestion.id] ?? "idle";
          const error = applyErrorById[suggestion.id];
          const applied = state === "applied" || state === "staged";
          const loading = state === "loading";

          return (
            <div className="relative py-2 pr-8 text-sm" key={suggestion.id}>
              <DismissButton
                className="absolute top-0.5 right-0"
                label={`Dismiss ${preview.title}`}
                onDismiss={() => onDismiss(`suggestion:${suggestion.id}`)}
              />
              <p className="text-pretty font-medium text-foreground">
                {preview.title}
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                {preview.description}
              </p>
              {preview.excerpt ? (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background/70 p-2 font-mono text-2xs text-foreground leading-relaxed">
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
    </ChatComposerNotice>
  );
}
