import { useState } from "react";
import type { OrgMemberSummary, ProfileSummary, SkillProposal } from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { useOrgMembers } from "@/hooks/use-org-members";
import {
  useApproveSkillProposal,
  useRejectSkillProposal,
  useSkillProposals,
} from "@/hooks/use-skill-proposals";
import { formatSessionRelativeTime, formatSessionTimestamp } from "@/lib/chat-history";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";

function shortenId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…` : value;
}

function resolveProposer(userId: string | null, members: OrgMemberSummary[]): string | null {
  if (!userId) {
    return null;
  }
  const member = members.find((entry) => entry.userId === userId);
  if (!member) {
    return shortenId(userId);
  }
  return member.name?.trim() || member.email;
}

function proposalPreview(proposal: SkillProposal): string {
  if (proposal.action === "create" && proposal.content) {
    return proposal.content;
  }
  if (proposal.action === "edit" && proposal.content) {
    return proposal.content;
  }
  if (proposal.action === "patch") {
    return `Replace:\n${proposal.patchOldString ?? ""}\n\nWith:\n${proposal.patchNewString ?? ""}`;
  }
  if (proposal.action === "write_file") {
    return `Write ${proposal.relativePath ?? "?"}:\n${proposal.content ?? ""}`;
  }
  if (proposal.action === "remove_file") {
    return `Remove supporting file "${proposal.relativePath ?? "?"}" from skill "${proposal.skillName}"`;
  }
  return `Delete skill "${proposal.skillName}"`;
}

function actionLabel(action: SkillProposal["action"]): string {
  if (action === "create") {
    return "Create";
  }
  if (action === "patch") {
    return "Patch";
  }
  if (action === "edit") {
    return "Edit";
  }
  if (action === "write_file") {
    return "Write file";
  }
  if (action === "remove_file") {
    return "Remove file";
  }
  return "Delete";
}

function ProposalReviewDialog({
  proposal,
  orgId,
  proposer,
  open,
  onOpenChange,
}: {
  proposal: SkillProposal;
  orgId: string;
  proposer: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const approveMutation = useApproveSkillProposal(orgId);
  const rejectMutation = useRejectSkillProposal(orgId);
  const busy = approveMutation.isPending || rejectMutation.isPending;
  const preview = proposalPreview(proposal);

  async function handleApprove() {
    try {
      await approveMutation.mutateAsync(proposal.id);
      toast(`Approved ${actionLabel(proposal.action).toLowerCase()} for "${proposal.skillName}".`);
      onOpenChange(false);
    } catch (err) {
      toast(formatError(err));
    }
  }

  async function handleReject() {
    try {
      await rejectMutation.mutateAsync(proposal.id);
      toast("Proposal rejected.");
      onOpenChange(false);
    } catch (err) {
      toast(formatError(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 overflow-hidden p-4 sm:max-w-lg sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {actionLabel(proposal.action)} skill &ldquo;{proposal.skillName}&rdquo;?
          </DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          <p className="text-xs text-muted-foreground">
            <time dateTime={proposal.createdAt} title={formatSessionTimestamp(proposal.createdAt)}>
              {formatSessionRelativeTime(proposal.createdAt)}
            </time>
            {proposer ? <> · {proposer}</> : null}
          </p>

          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-foreground">
            {preview}
          </pre>

          {proposal.warnings && proposal.warnings.length > 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {proposal.warnings.join(" ")}
            </p>
          ) : null}
        </div>

        <DialogFooter className="mx-0 mb-0 gap-2 border-t-0 bg-transparent p-0 pt-2 sm:justify-end">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void handleReject()}>
            {rejectMutation.isPending ? <Spinner className="mr-2" /> : null}
            Reject
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void handleApprove()}>
            {approveMutation.isPending ? <Spinner className="mr-2" /> : null}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function resolveProfileLabel(profileId: string, profiles: ProfileSummary[]): string {
  return profiles.find((profile) => profile.id === profileId)?.name ?? shortenId(profileId);
}

function ProposalRow({
  proposal,
  orgId,
  proposer,
  profileLabel,
}: {
  proposal: SkillProposal;
  orgId: string;
  proposer: string | null;
  profileLabel?: string | null;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const preview = proposalPreview(proposal);

  return (
    <>
      <div className="flex items-start gap-2 overflow-hidden py-2 pl-4 pr-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">
            {actionLabel(proposal.action)} · {proposal.skillName}
          </p>
          <p className="line-clamp-3 max-w-full min-w-0 break-all font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {preview}
          </p>
          {proposal.warnings && proposal.warnings.length > 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Warning: {proposal.warnings.join(" ")}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            <time dateTime={proposal.createdAt} title={formatSessionTimestamp(proposal.createdAt)}>
              {formatSessionRelativeTime(proposal.createdAt)}
            </time>
            {profileLabel ? <> · {profileLabel}</> : null}
            {proposer ? <> · {proposer}</> : null}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setDialogOpen(true)}>
          Review
        </Button>
      </div>

      <ProposalReviewDialog
        proposal={proposal}
        orgId={orgId}
        proposer={proposer}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}

export function SkillProposalsPanel({
  orgId,
  profileId,
  showProfileLabels = false,
}: {
  orgId: string;
  profileId?: string;
  showProfileLabels?: boolean;
}) {
  const { data, isLoading, error } = useSkillProposals(orgId, {
    status: "pending",
    profileId,
  });
  const { data: membersData } = useOrgMembers(orgId);
  const { data: profiles = [] } = useProfilesQuery();
  const proposals = data?.proposals ?? [];
  const members = membersData?.members ?? [];

  if (isLoading) {
    return <p className="px-4 py-2 text-xs text-muted-foreground">Loading proposals…</p>;
  }

  if (error) {
    return (
      <p className="px-4 py-2 text-sm text-destructive" role="alert">
        {formatError(error)}
      </p>
    );
  }

  if (proposals.length === 0) {
    return <p className="px-4 py-2 text-xs text-muted-foreground">No pending skill proposals.</p>;
  }

  return (
    <div className="min-w-0 divide-y divide-border">
      {proposals.map((proposal) => (
        <ProposalRow
          key={proposal.id}
          proposal={proposal}
          orgId={orgId}
          proposer={resolveProposer(proposal.proposedByUserId, members)}
          profileLabel={
            showProfileLabels ? resolveProfileLabel(proposal.profileId, profiles) : null
          }
        />
      ))}
    </div>
  );
}
