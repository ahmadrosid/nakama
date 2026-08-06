import { useState } from "react";
import type { OrgRole } from "@nakama/core/contract";
import { CheckIcon, CopyIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OrgMemberInvitePopover } from "@/components/settings/org-member-dialogs";

export function OrgMembersCardHeader({
  orgId,
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
  orgId: string;
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
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-sm font-medium leading-none text-foreground">Organization</span>
        <code className="inline-flex h-7 max-w-[14rem] items-center truncate rounded border border-border bg-muted/30 px-1.5 font-mono text-[11px] leading-none text-foreground sm:max-w-xs">
          {orgId}
        </code>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-7 shrink-0"
          aria-label={copiedOrgId ? "Copied org ID" : "Copy org ID"}
          onClick={() => void handleCopyOrgId()}
        >
          {copiedOrgId ? (
            <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <CopyIcon className="size-3.5" aria-hidden />
          )}
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <OrgMemberInvitePopover
          open={inviteOpen}
          inviteEmail={inviteEmail}
          inviteRole={inviteRole}
          formError={inviteFormError}
          pending={invitePending}
          onOpenChange={onInviteOpenChange}
          onInviteEmailChange={onInviteEmailChange}
          onInviteRoleChange={onInviteRoleChange}
          onSubmit={onInviteSubmit}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Add member"
                onClick={onAddMember}
              >
                <UserPlusIcon className="size-3.5" aria-hidden />
              </Button>
            }
          />
          <TooltipContent side="top" sideOffset={8}>
            Add member
          </TooltipContent>
        </Tooltip>
      </div>
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
        <p className="text-xs text-emerald-200" role="status">
          {secretHint}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
          {secretValue}
        </code>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label="Copy"
          onClick={onCopy}
        >
          <CopyIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
