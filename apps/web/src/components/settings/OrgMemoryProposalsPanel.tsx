import { useState, type ReactNode } from "react";
import type { OrgMemoryProposal, OrgMemberSummary, ProfileSummary } from "@nakama/core/contract";
import {
  detectOrgMemoryInjectionWarnings,
} from "@nakama/core/soul/org-memory";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useApproveOrgMemoryProposal,
  useOrgMemoryProposals,
  useRejectOrgMemoryProposal,
} from "@/hooks/use-org-memory-proposals";
import { useOrgMembers } from "@/hooks/use-org-members";
import { formatSessionRelativeTime, formatSessionTimestamp } from "@/lib/chat-history";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";

function shortenId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…` : value;
}

function resolveProfileLabel(
  profileId: string | null,
  profiles: ProfileSummary[],
): string | null {
  if (!profileId) {
    return null;
  }
  return profiles.find((profile) => profile.id === profileId)?.name ?? shortenId(profileId);
}

interface ProposerInfo {
  name: string;
  email?: string;
}

function resolveProposer(
  userId: string | null,
  members: OrgMemberSummary[],
): ProposerInfo | null {
  if (!userId) {
    return null;
  }
  const member = members.find((entry) => entry.userId === userId);
  if (!member) {
    return { name: shortenId(userId) };
  }
  const name = member.name?.trim() || member.email;
  return {
    name,
    email: member.name?.trim() ? member.email : undefined,
  };
}

function ProposalMetadataTableRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <th
        scope="row"
        className="w-[4.5rem] border-r border-border px-2 py-1 align-top text-left font-normal text-muted-foreground"
      >
        {label}
      </th>
      <td className="px-2 py-1 align-top text-foreground">{children}</td>
    </tr>
  );
}

function ProposalMetadata({
  proposal,
  profileLabel,
  proposer,
  variant = "compact",
}: {
  proposal: OrgMemoryProposal;
  profileLabel: string | null;
  proposer: ProposerInfo | null;
  variant?: "compact" | "detail";
}) {
  const relativeTime = formatSessionRelativeTime(proposal.createdAt);
  const absoluteTime = formatSessionTimestamp(proposal.createdAt);

  if (variant === "compact") {
    return (
      <p className="text-xs text-muted-foreground">
        <time dateTime={proposal.createdAt} title={absoluteTime}>
          {relativeTime}
        </time>
        {profileLabel ? <> · {profileLabel}</> : null}
        {proposer ? <> · {proposer.name}</> : null}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse text-xs">
        <tbody>
          {proposer ? (
            <ProposalMetadataTableRow label="By">
              <span className="min-w-0">
                <span className="text-foreground">{proposer.name}</span>
                {proposer.email ? (
                  <span className="text-muted-foreground"> · {proposer.email}</span>
                ) : null}
              </span>
            </ProposalMetadataTableRow>
          ) : null}
          <ProposalMetadataTableRow label="When">
            <time dateTime={proposal.createdAt} title={absoluteTime}>
              {relativeTime}
            </time>
          </ProposalMetadataTableRow>
          {profileLabel ? (
            <ProposalMetadataTableRow label="Agent">{profileLabel}</ProposalMetadataTableRow>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ProposalReviewDialog({
  proposal,
  orgId,
  profileLabel,
  proposer,
  open,
  onOpenChange,
}: {
  proposal: OrgMemoryProposal;
  orgId: string;
  profileLabel: string | null;
  proposer: ProposerInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pinOnApprove, setPinOnApprove] = useState(false);
  const approveMutation = useApproveOrgMemoryProposal(orgId);
  const rejectMutation = useRejectOrgMemoryProposal(orgId);
  const warnings = detectOrgMemoryInjectionWarnings(proposal.bullet);
  const busy = approveMutation.isPending || rejectMutation.isPending;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setPinOnApprove(false);
    }
    onOpenChange(nextOpen);
  }

  async function handleApprove() {
    try {
      await approveMutation.mutateAsync({
        proposalId: proposal.id,
        request: { pin: pinOnApprove },
      });
      toast(pinOnApprove ? "Proposal approved and pinned." : "Proposal approved.");
      handleOpenChange(false);
    } catch (err) {
      toast(formatError(err));
    }
  }

  async function handleReject() {
    try {
      await rejectMutation.mutateAsync(proposal.id);
      toast("Proposal rejected.");
      handleOpenChange(false);
    } catch (err) {
      toast(formatError(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-4 overflow-hidden p-4 sm:max-w-md sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle>Approve for org memory?</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs text-black dark:text-white">Content:</p>
            <p className="max-w-full min-w-0 border-l-2 border-primary/40 bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-foreground">
              {proposal.bullet}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-black dark:text-white">Metadata:</p>
            <ProposalMetadata
              proposal={proposal}
              profileLabel={profileLabel}
              proposer={proposer}
              variant="detail"
            />
          </div>

          {warnings.length > 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {warnings.join(" ")}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <p className="text-xs text-black dark:text-white">Pin for all agents?</p>
            <div className="flex items-start gap-2">
              <Switch
                id={`pin-dialog-${proposal.id}`}
                size="sm"
                checked={pinOnApprove}
                disabled={busy}
                onCheckedChange={setPinOnApprove}
                aria-label="Yes / No"
                className="mt-0.5"
              />
              <label
                htmlFor={`pin-dialog-${proposal.id}`}
                className="pt-0.5 text-sm font-base text-foreground"
              >
                Yes / No
              </label>
            </div>
          </div>
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

function ProposalRow({
  proposal,
  orgId,
  profileLabel,
  proposer,
}: {
  proposal: OrgMemoryProposal;
  orgId: string;
  profileLabel: string | null;
  proposer: ProposerInfo | null;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const warnings = detectOrgMemoryInjectionWarnings(proposal.bullet);

  return (
    <>
      <div className="flex items-start gap-2 overflow-hidden py-2 pl-4 pr-4">
        <div className="min-w-0 flex-1 overflow-hidden space-y-1">
          <p className="max-w-full min-w-0 break-all text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {proposal.bullet}
          </p>
          {warnings.length > 0 ? (
            <p className="break-all text-xs text-amber-600 dark:text-amber-400">
              Warning: {warnings.join(" ")}
            </p>
          ) : null}
          <ProposalMetadata
            proposal={proposal}
            profileLabel={profileLabel}
            proposer={proposer}
          />
        </div>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setDialogOpen(true)}>
          Review
        </Button>
      </div>

      <ProposalReviewDialog
        proposal={proposal}
        orgId={orgId}
        profileLabel={profileLabel}
        proposer={proposer}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}

export function OrgMemoryProposalsPanel({ orgId }: { orgId: string }) {
  const { data, isLoading, error } = useOrgMemoryProposals(orgId, "pending");
  const { data: profiles = [] } = useProfilesQuery();
  const { data: membersData } = useOrgMembers(orgId);
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
    return <p className="px-4 py-2 text-xs text-muted-foreground">No pending proposals.</p>;
  }

  return (
    <div className="min-w-0 divide-y divide-border">
      {proposals.map((proposal) => (
        <ProposalRow
          key={proposal.id}
          proposal={proposal}
          orgId={orgId}
          profileLabel={resolveProfileLabel(proposal.profileId, profiles)}
          proposer={resolveProposer(proposal.proposedByUserId, members)}
        />
      ))}
    </div>
  );
}
