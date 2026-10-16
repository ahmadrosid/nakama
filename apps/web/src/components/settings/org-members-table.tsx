import type { OrgMemberSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Spinner } from "@nakama/ui/spinner";
import {
  Delete02Icon,
  Edit03Icon,
  MoreHorizontalIcon,
  UserBlock01Icon,
  UserCheck01Icon,
} from "hugeicons-react";

const JOINED_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const CELL = "px-4 py-3 align-middle";

function formatJoined(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : JOINED_FORMAT.format(date);
}

export function OrgMembersTable({
  members,
  currentUserEmail,
  isLoading,
  updatePending,
  removePending,
  disablePending = false,
  onEdit,
  onRemove,
  onToggleDisabled,
}: {
  members: OrgMemberSummary[];
  currentUserEmail?: string;
  isLoading: boolean;
  updatePending: boolean;
  removePending: boolean;
  disablePending?: boolean;
  /** Without both handlers the table is read-only and has no actions column. */
  onEdit?: (member: OrgMemberSummary) => void;
  onRemove?: (member: OrgMemberSummary) => void;
  /** Platform admins only: disabling an account is install-wide. */
  onToggleDisabled?: (member: OrgMemberSummary) => void;
}) {
  const editable = Boolean(onEdit && onRemove);

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
    <table
      aria-label="Organization members"
      className="w-full table-fixed text-sm"
    >
      <thead>
        <tr className="bg-muted/40 text-left text-muted-foreground">
          <th className="px-4 py-2.5 font-normal">Name</th>
          <th className="w-20 px-2 py-2.5 font-normal sm:w-28">Role</th>
          <th className="w-28 px-2 py-2.5 font-normal sm:w-36">Joined</th>
          {editable ? (
            <th className="w-12 px-2 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody className="divide-y divide-border border-border border-t">
        {members.map((member) => {
          const isSelf = member.email === currentUserEmail;
          const displayName = member.name?.trim() || member.email;

          return (
            <tr key={member.userId}>
              <td className={CELL}>
                <p className="truncate text-foreground">
                  {displayName}
                  {isSelf ? (
                    <span className="ml-1.5 text-muted-foreground">(you)</span>
                  ) : null}
                  {member.disabledAt ? (
                    <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                      Disabled
                    </span>
                  ) : null}
                </p>
                {member.name ? (
                  <p className="truncate text-muted-foreground">
                    {member.email}
                  </p>
                ) : null}
              </td>
              <td className={`${CELL} px-2 capitalize`}>{member.role}</td>
              <td className={`${CELL} px-2 text-muted-foreground`}>
                {formatJoined(member.createdAt)}
              </td>
              {editable ? (
                <td className={`${CELL} px-2 text-right`}>
                  {isSelf ? null : (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            aria-label={`Actions for ${displayName}`}
                            className="text-muted-foreground"
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          />
                        }
                      >
                        <MoreHorizontalIcon aria-hidden className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          aria-label={`Edit ${displayName}`}
                          disabled={updatePending}
                          onClick={() => onEdit?.(member)}
                        >
                          <Edit03Icon aria-hidden />
                          Edit
                        </DropdownMenuItem>
                        {onToggleDisabled ? (
                          <DropdownMenuItem
                            aria-label={`${member.disabledAt ? "Enable" : "Disable"} ${displayName}`}
                            disabled={disablePending}
                            onClick={() => onToggleDisabled(member)}
                          >
                            {member.disabledAt ? (
                              <UserCheck01Icon aria-hidden />
                            ) : (
                              <UserBlock01Icon aria-hidden />
                            )}
                            {member.disabledAt ? "Enable" : "Disable"}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          aria-label={`Remove ${displayName}`}
                          disabled={removePending}
                          onClick={() => onRemove?.(member)}
                          variant="destructive"
                        >
                          <Delete02Icon aria-hidden />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
