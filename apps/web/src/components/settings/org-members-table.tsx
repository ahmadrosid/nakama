import type { OrgMemberSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Spinner } from "@nakama/ui/spinner";
import { Delete02Icon, Edit03Icon, MoreHorizontalIcon } from "hugeicons-react";

const JOINED_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_5rem_7.5rem_2rem] items-center gap-3 px-4 sm:grid-cols-[minmax(0,1fr)_7rem_9rem_2rem]";

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
  onEdit,
  onRemove,
}: {
  members: OrgMemberSummary[];
  currentUserEmail?: string;
  isLoading: boolean;
  updatePending: boolean;
  removePending: boolean;
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
    <div aria-label="Organization members" className="text-sm" role="table">
      <div
        className={`${ROW_GRID} bg-muted/40 py-2.5 text-muted-foreground`}
        role="row"
      >
        <span role="columnheader">Name</span>
        <span role="columnheader">Role</span>
        <span role="columnheader">Joined</span>
        <span />
      </div>
      <div className="divide-y divide-border border-border border-t">
        {members.map((member) => {
          const isSelf = member.email === currentUserEmail;
          const displayName = member.name?.trim() || member.email;

          return (
            <div className={`${ROW_GRID} py-3`} key={member.userId} role="row">
              <div className="min-w-0" role="cell">
                <p className="truncate text-foreground">
                  {displayName}
                  {isSelf ? (
                    <span className="ml-1.5 text-muted-foreground">(you)</span>
                  ) : null}
                </p>
                {member.name ? (
                  <p className="truncate text-muted-foreground">
                    {member.email}
                  </p>
                ) : null}
              </div>
              <span className="capitalize" role="cell">
                {member.role}
              </span>
              <span className="text-muted-foreground" role="cell">
                {formatJoined(member.createdAt)}
              </span>
              <div className="flex justify-end" role="cell">
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
                        onClick={() => onEdit(member)}
                      >
                        <Edit03Icon aria-hidden />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        aria-label={`Remove ${displayName}`}
                        disabled={removePending}
                        onClick={() => onRemove(member)}
                        variant="destructive"
                      >
                        <Delete02Icon aria-hidden />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
