import type { SkillProposal, SkillSuggestion } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  File01Icon,
  QuillWrite02Icon,
} from "hugeicons-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChatComposerNotice } from "@/components/chat/chat-tips";
import { skillSuggestionPreview } from "@/components/chat/skill-post-turn-review.shared";
import { buildFileDiffRows, FileDiff } from "@/components/file-diff";
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

function PendingProposalRow({
  onDismiss,
  proposal,
}: {
  onDismiss: () => void;
  proposal: SkillProposal;
}) {
  const action = proposal.action.replaceAll("_", " ");
  const title = `${action.charAt(0).toUpperCase()}${action.slice(1)} “${proposal.skillName}”`;

  return (
    <div className="text-sm">
      <div className="flex items-center gap-2">
        <QuillWrite02Icon
          aria-hidden
          className="size-3.5 shrink-0"
          strokeWidth={1.5}
        />
        <p className="min-w-0 flex-1 truncate font-medium text-foreground">
          {title}
        </p>
        <div className="flex shrink-0 items-center">
          <Link
            className="px-1.5 text-xs underline underline-offset-2 hover:text-foreground"
            to={orgSkillProposalsPath(proposal.profileId)}
          >
            Review
          </Link>
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
  onApply,
  onDismiss,
}: SkillPostTurnReviewBannerProps) {
  const [openIds, setOpenIds] = useState<readonly string[]>([]);

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

          const status = (
            <>
              {error ? (
                <p className="mt-2 text-destructive text-xs">{error}</p>
              ) : null}
              {state === "staged" ? (
                <p className="mt-2 text-muted-foreground text-xs">
                  Write approval is on — staged for admin review instead of
                  writing immediately.
                </p>
              ) : null}
            </>
          );

          const fileCard = suggestion.action === "create" && suggestion.content;

          const applyButton = (
            <Button
              disabled={applied || loading}
              onClick={() => onApply(suggestion.id)}
              size={fileCard ? "default" : "sm"}
              type="button"
            >
              {loading ? <Spinner className="mr-2" /> : null}
              {applied ? (state === "staged" ? "Staged" : "Applied") : "Apply"}
            </Button>
          );

          const dismissButton = (
            <DismissButton
              label={`Dismiss ${preview.title}`}
              onDismiss={() => onDismiss(`suggestion:${suggestion.id}`)}
            />
          );

          if (fileCard) {
            const rows = buildFileDiffRows(null, suggestion.content);

            const notes = (suggestion.warnings ?? []).map((warning) =>
              warning.replace(/^Contains\s+/i, "").replace(/\.$/, "")
            );

            const open = openIds.includes(suggestion.id);

            return (
              <div className="-mx-3 text-sm" key={suggestion.id}>
                <div className="flex items-start gap-3 px-3 py-2">
                  <File01Icon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      New skill:{" "}
                      <span className="font-mono">{suggestion.skillName}</span>
                    </p>
                    <p className="truncate text-muted-foreground text-xs">
                      {preview.description}
                    </p>
                  </div>
                  <Button
                    onClick={() => onDismiss(`suggestion:${suggestion.id}`)}
                    type="button"
                    variant="ghost"
                  >
                    Dismiss
                  </Button>
                  {applyButton}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-border border-t bg-muted/40 px-3 py-1.5 text-muted-foreground text-xs">
                  <button
                    aria-expanded={open}
                    className="-mx-1 inline-flex min-h-8 items-center gap-1 rounded px-1 font-medium text-foreground hover:bg-muted"
                    onClick={() =>
                      setOpenIds((ids) =>
                        open
                          ? ids.filter((id) => id !== suggestion.id)
                          : [...ids, suggestion.id]
                      )
                    }
                    type="button"
                  >
                    <ArrowRight01Icon
                      aria-hidden
                      className={cn(
                        "size-3.5 transition-transform",
                        open && "rotate-90"
                      )}
                      strokeWidth={2}
                    />
                    SKILL.md · {rows.length} lines
                  </button>
                  {notes.map((note) => (
                    <span key={note}>{note}</span>
                  ))}
                </div>
                {open ? (
                  <FileDiff
                    className="max-h-64 overflow-auto border-border border-t"
                    rows={rows}
                    wrap
                  />
                ) : null}
                {error || state === "staged" ? (
                  <div className="px-3 pb-2">{status}</div>
                ) : null}
              </div>
            );
          }

          return (
            <div className="relative py-2 pr-8 text-sm" key={suggestion.id}>
              <div className="absolute top-0.5 right-0">{dismissButton}</div>
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
              {status}
              <div className="mt-2 flex items-center gap-2">{applyButton}</div>
            </div>
          );
        })}
      </div>
    </ChatComposerNotice>
  );
}
