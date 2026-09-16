import type { OrgMemberSummary, OrgRole } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { Delete02Icon, Edit03Icon } from "hugeicons-react";
import { OrgMemberRoleSelect } from "@/components/settings/org-member-role-select";

export function OrgMembersTable({
  members,
  currentUserEmail,
  isLoading,
  updatePending,
  removePending,
  onRoleChange,
  onEdit,
  onRemove,
}: {
  members: OrgMemberSummary[];
  currentUserEmail?: string;
  isLoading: boolean;
  updatePending: boolean;
  removePending: boolean;
  onRoleChange: (userId: string, role: OrgRole) => void;
  onEdit: (member: OrgMemberSummary) => void;
  onRemove: (member: OrgMemberSummary) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-muted-foreground text-sm">
        <Spinner />
        Loading members…
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <p className="px-4 py-2 text-muted-foreground text-sm">No members yet.</p>
    );
  }

  return (
    <ul
      aria-label="Organization members"
      className="divide-y divide-border text-sm"
    >
      {members.map((member) => {
        const isSelf = member.email === currentUserEmail;
        const displayName = member.name?.trim() || member.email;

        return (
          <li
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            key={member.userId}
          >
            <div className="min-w-0 flex-1 basis-40">
              <p className="truncate font-normal text-foreground">
                {displayName}
                {isSelf ? (
                  <span className="ml-1.5 font-normal text-muted-foreground text-xs">
                    (you)
                  </span>
                ) : null}
              </p>
              {member.name ? (
                <p className="truncate text-muted-foreground text-xs">
                  {member.email}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <OrgMemberRoleSelect
                disabled={updatePending}
                onChange={(role) => onRoleChange(member.userId, role)}
                value={member.role}
              />
              <div className="flex items-center justify-end gap-1">
                <Button
                  aria-label={`Edit ${displayName}`}
                  className="text-muted-foreground"
                  disabled={updatePending}
                  onClick={() => onEdit(member)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Edit03Icon className="size-3.5" />
                </Button>
                <Button
                  aria-label={`Remove ${displayName}`}
                  className="text-muted-foreground hover:text-destructive"
                  disabled={removePending}
                  onClick={() => onRemove(member)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Delete02Icon className="size-3.5" />
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
