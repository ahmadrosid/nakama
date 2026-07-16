import { CopyIcon, PlusIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OrgMembersCardHeader({
  orgName,
  onInvite,
  onAddMember,
}: {
  orgName: string;
  onInvite: () => void;
  onAddMember: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">Organization</p>
        <p className="text-xs text-muted-foreground">{orgName} · manage members and roles</p>
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
