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
  onRemove: (userId: string, email: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Loading members…
      </div>
    );
  }

  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground">No members yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Member</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {members.map((member) => {
            const isSelf = member.email === currentUserEmail;
            const displayName = member.name?.trim() || member.email;

            return (
              <tr key={member.userId}>
                <td className="px-3 py-2">
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
                <td className="px-3 py-2">
                  <OrgMemberRoleSelect
                    value={member.role}
                    disabled={updatePending}
                    onChange={(role) => onRoleChange(member.userId, role)}
                  />
                </td>
                <td className="px-3 py-2">
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
                      onClick={() => onRemove(member.userId, member.email)}
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
