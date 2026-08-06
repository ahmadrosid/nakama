import type { OrgMemberSummary, OrgRole } from "@nakama/core/contract";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        <Spinner />
        Loading members…
      </div>
    );
  }

  if (members.length === 0) {
    return <p className="px-4 py-2 text-sm text-muted-foreground">No members yet.</p>;
  }

  const headerMemberClass =
    "border-b border-r border-border py-2 pl-4 pr-2 font-medium";
  const headerRoleClass =
    "border-b border-r border-border px-2 py-2 font-medium";
  const headerActionsClass =
    "border-b border-border py-2 pl-2 pr-4 font-medium";
  const memberCellClass =
    "border-b border-r border-border py-1.5 pl-4 pr-2";
  const roleCellClass =
    "border-b border-r border-border px-2 py-1.5";
  const actionsCellClass =
    "border-b border-border py-1.5 pl-2 pr-4";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className={headerMemberClass}>Member</th>
            <th className={headerRoleClass}>Role</th>
            <th className={headerActionsClass}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const isSelf = member.email === currentUserEmail;
            const displayName = member.name?.trim() || member.email;

            return (
              <tr key={member.userId} className="last:[&>td]:border-b-0">
                <td className={memberCellClass}>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {displayName}
                      {isSelf ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          (you)
                        </span>
                      ) : null}
                    </p>
                    {member.name ? (
                      <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                    ) : null}
                  </div>
                </td>
                <td className={roleCellClass}>
                  <OrgMemberRoleSelect
                    value={member.role}
                    disabled={updatePending}
                    onChange={(role) => onRoleChange(member.userId, role)}
                  />
                </td>
                <td className={actionsCellClass}>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      aria-label={`Edit ${displayName}`}
                      disabled={updatePending}
                      onClick={() => onEdit(member)}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${displayName}`}
                      disabled={removePending}
                      onClick={() => onRemove(member)}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
