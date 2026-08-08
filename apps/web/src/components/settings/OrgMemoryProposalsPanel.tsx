import type {
  OrgMemberSummary,
  OrgMemoryProposal,
  ProfileSummary,
} from "@nakama/core/contract";
import { detectOrgMemoryInjectionWarnings } from "@nakama/core/soul/org-memory";
import { type ReactNode, useState } from "react";
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
import { useOrgMembers } from "@/hooks/use-org-members";
import {
  useApproveOrgMemoryProposal,
  useOrgMemoryProposals,
  useRejectOrgMemoryProposal,
} from "@/hooks/use-org-memory-proposals";
import {
  formatSessionRelativeTime,
  formatSessionTimestamp,
} from "@/lib/chat-history";
import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";

function shortenId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…` : value;
}

function resolveProfileLabel(
  profileId: string | null,
  profiles: ProfileSummary[]
): string | null {
  if (!profileId) {
    return null;
  }
  return (
    profiles.find((profile) => profile.id === profileId)?.name ??
    shortenId(profileId)
  );
}

interface ProposerInfo {
  email?: string;
  name: string;
}

function resolveProposer(
  userId: string | null,
  members: OrgMemberSummary[]
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
    email: member.name?.trim() ? member.email : undefined,
    name,
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
    <tr className="border-border border-b last:border-b-0">
      <th
        className="w-[4.5rem] border-border border-r px-2 py-1 text-left align-top font-normal text-muted-foreground"
        scope="row"
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
      <p className="text-muted-foreground text-xs">
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
                  <span className="text-muted-foreground">
                    {" "}
                    · {proposer.email}
                  </span>
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
            <ProposalMetadataTableRow label="Agent">
              {profileLabel}
            </ProposalMetadataTableRow>
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
      toast(
        pinOnApprove ? "Proposal approved and pinned." : "Proposal approved."
      );
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
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-4 overflow-hidden p-4 sm:max-w-md sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle>Approve for org memory?</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-black text-xs dark:text-white">Content:</p>
            <p className="min-w-0 max-w-full whitespace-pre-wrap break-all border-primary/40 border-l-2 bg-muted/50 px-3 py-2 font-mono text-foreground text-xs leading-relaxed">
              {proposal.bullet}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-black text-xs dark:text-white">Metadata:</p>
            <ProposalMetadata
              profileLabel={profileLabel}
              proposal={proposal}
              proposer={proposer}
              variant="detail"
            />
          </div>

          {warnings.length > 0 ? (
            <p className="text-amber-600 text-xs dark:text-amber-400">
              {warnings.join(" ")}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <p className="text-black text-xs dark:text-white">
              Pin for all agents?
            </p>
            <div className="flex items-start gap-2">
              <Switch
                aria-label="Yes / No"
                checked={pinOnApprove}
                className="mt-0.5"
                disabled={busy}
                id={`pin-dialog-${proposal.id}`}
                onCheckedChange={setPinOnApprove}
                size="sm"
              />
              <label
                className="pt-0.5 font-base text-foreground text-sm"
                htmlFor={`pin-dialog-${proposal.id}`}
              >
                Yes / No
              </label>
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 gap-2 border-t-0 bg-transparent p-0 pt-2 sm:justify-end">
          <Button
            disabled={busy}
            onClick={() => void handleReject()}
            size="sm"
            type="button"
            variant="outline"
          >
            {rejectMutation.isPending ? <Spinner className="mr-2" /> : null}
            Reject
          </Button>
          <Button
            disabled={busy}
            onClick={() => void handleApprove()}
            size="sm"
            type="button"
          >
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
      <div className="flex items-start gap-2 overflow-hidden py-2 pr-4 pl-4">
        <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
          <p className="min-w-0 max-w-full whitespace-pre-wrap break-all text-foreground text-sm leading-relaxed">
            {proposal.bullet}
          </p>
          {warnings.length > 0 ? (
            <p className="break-all text-amber-600 text-xs dark:text-amber-400">
              Warning: {warnings.join(" ")}
            </p>
          ) : null}
          <ProposalMetadata
            profileLabel={profileLabel}
            proposal={proposal}
            proposer={proposer}
          />
        </div>
        <Button
          className="shrink-0"
          onClick={() => setDialogOpen(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          Review
        </Button>
      </div>

      <ProposalReviewDialog
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        orgId={orgId}
        profileLabel={profileLabel}
        proposal={proposal}
        proposer={proposer}
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
    return (
      <p className="px-4 py-2 text-muted-foreground text-xs">
        Loading proposals…
      </p>
    );
  }

  if (error) {
    return (
      <p className="px-4 py-2 text-destructive text-sm" role="alert">
        {formatError(error)}
      </p>
    );
  }

  if (proposals.length === 0) {
    return (
      <p className="px-4 py-2 text-muted-foreground text-xs">
        No pending proposals.
      </p>
    );
  }

  return (
    <div className="min-w-0 divide-y divide-border">
      {proposals.map((proposal) => (
        <ProposalRow
          key={proposal.id}
          orgId={orgId}
          profileLabel={resolveProfileLabel(proposal.profileId, profiles)}
          proposal={proposal}
          proposer={resolveProposer(proposal.proposedByUserId, members)}
        />
      ))}
    </div>
  );
}
