import type { OrgRole } from "@nakama/core/contract";
import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  UserAdd01Icon,
} from "hugeicons-react";
import { useState } from "react";
import { OrgMemberInvitePopover } from "@/components/settings/org-member-dialogs";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
        <span className="shrink-0 font-medium text-foreground text-sm leading-none">
          Organization
        </span>
        <code className="inline-flex h-7 max-w-[14rem] items-center truncate rounded border border-border bg-muted/30 px-1.5 font-mono text-[11px] text-foreground leading-none sm:max-w-xs">
          {orgId}
        </code>
        <Button
          aria-label={copiedOrgId ? "Copied org ID" : "Copy org ID"}
          className="size-7 shrink-0"
          onClick={() => void handleCopyOrgId()}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {copiedOrgId ? (
            <CheckmarkCircle01Icon
              aria-hidden
              className="size-3.5 text-emerald-600 dark:text-emerald-400"
            />
          ) : (
            <Copy01Icon aria-hidden className="size-3.5" />
          )}
        </Button>
      </div>
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
