import { useState } from "react";
import { CheckIcon, CopyIcon, PlusIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OrgMembersCardHeader({
  orgId,
  onInvite,
  onAddMember,
}: {
  orgId: string;
  onInvite: () => void;
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
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">Organization</p>
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="text-xs text-muted-foreground">Org ID</span>
          <code className="max-w-[14rem] truncate rounded border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-[11px] text-foreground sm:max-w-xs">
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
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onInvite}>
          <PlusIcon className="size-3.5" aria-hidden="true" />
          Invite
        </Button>
        <Button type="button" size="sm" onClick={onAddMember}>
          <UserPlusIcon className="size-3.5" aria-hidden="true" />
          Add member
        </Button>
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
