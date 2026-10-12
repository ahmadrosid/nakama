import type { OrgRole } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  UserAdd01Icon,
} from "hugeicons-react";
import { useState } from "react";
import { OrgMemberInvitePopover } from "@/components/settings/org-member-dialogs";

export function OrgIdRow({
  orgId,
  isTeam = false,
}: {
  orgId: string;
  isTeam?: boolean;
}) {
  const [copiedOrgId, setCopiedOrgId] = useState(false);

  async function handleCopyOrgId() {
    try {
      await navigator.clipboard.writeText(orgId);
      setCopiedOrgId(true);
      window.setTimeout(() => setCopiedOrgId(false), 2000);
    } catch {
      // Clipboard may be unavailable outside secure context.
    }
  }

  return (
    <div className="space-y-2 px-4 pt-2 pb-4">
      <span className="block font-medium text-foreground text-sm">
        {isTeam ? "Team ID" : "Organization ID"}
      </span>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 py-2 pr-2 pl-4">
        <code className="min-w-0 truncate font-mono text-foreground text-sm">
          {orgId}
        </code>
        <Button
          aria-label={
            isTeam
              ? copiedOrgId
                ? "Copied team ID"
                : "Copy team ID"
              : copiedOrgId
                ? "Copied org ID"
                : "Copy org ID"
          }
          className="shrink-0"
          onClick={() => void handleCopyOrgId()}
          type="button"
          variant="outline"
        >
          {copiedOrgId ? (
            <CheckmarkCircle01Icon
              aria-hidden
              className="size-4 text-emerald-600 dark:text-emerald-400"
            />
          ) : (
            <Copy01Icon aria-hidden className="size-4" />
          )}
          {copiedOrgId ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function OrgMembersActions({
  inviteOpen,
  inviteEmail,
  inviteRole,
  inviteFormError,
  invitePending,
  onInviteOpenChange,
  onInviteEmailChange,
  onInviteRoleChange,
  onInviteSubmit,
  onAddMember,
}: {
  inviteOpen: boolean;
  inviteEmail: string;
  inviteRole: OrgRole;
  inviteFormError: string | null;
  invitePending: boolean;
  onInviteOpenChange: (open: boolean) => void;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (role: OrgRole) => void;
  onInviteSubmit: (event: React.FormEvent) => void;
  onAddMember: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <OrgMemberInvitePopover
        formError={inviteFormError}
        inviteEmail={inviteEmail}
        inviteRole={inviteRole}
        onInviteEmailChange={onInviteEmailChange}
        onInviteRoleChange={onInviteRoleChange}
        onOpenChange={onInviteOpenChange}
        onSubmit={onInviteSubmit}
        open={inviteOpen}
        pending={invitePending}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Add member"
              onClick={onAddMember}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <UserAdd01Icon aria-hidden className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent side="top" sideOffset={8}>
          Add member
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function OrgMembersSecretBanner({
  secretHint,
  secretValue,
  onCopy,
}: {
  secretHint: string | null;
  secretValue: string;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-2 px-4 py-3">
      {secretHint ? (
        <p className="text-emerald-200 text-xs" role="status">
          {secretHint}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
          {secretValue}
        </code>
        <Button
          aria-label="Copy"
          onClick={onCopy}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <Copy01Icon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
