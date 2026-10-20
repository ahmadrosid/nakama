import { Button, Card } from "@nakama/ui";
import { Spinner } from "@nakama/ui/spinner";
import { PlusSignIcon } from "hugeicons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GroupAvatar } from "@/components/agent-groups/GroupAvatar";
import { GroupDialog } from "@/components/agent-groups/group-dialog";
import { useAgentGroupsQuery } from "@/hooks/use-agent-groups";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { groupPath } from "@/lib/navigation";

export function AgentGroupsPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data: groups = [], isLoading } = useAgentGroupsQuery();
  const { data: profiles = [] } = useProfilesQuery();

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-4"
      id="agent-groups-page"
    >
      <div className="flex justify-end">
        <Button id="btn-new-group" onClick={() => setCreating(true)}>
          <PlusSignIcon className="size-4" />
          New group
        </Button>
      </div>
      {isLoading ? (
        <div className="flex min-h-32 items-center justify-center">
          <Spinner className="size-5" />
        </div>
      ) : groups.length === 0 ? (
        <Card className="py-8 text-center text-muted-foreground text-sm shadow-none">
          No groups yet
        </Card>
      ) : (
        <Card
          className="divide-y divide-border overflow-hidden shadow-none"
          id="agent-group-list"
        >
          {groups.map((group) => (
            <Link
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              key={group.id}
              to={groupPath(group.id)}
            >
              <GroupAvatar
                className="size-9"
                group={group}
                profiles={profiles}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-sm">
                {group.name}
              </span>
              <span className="shrink-0 text-muted-foreground text-xs">
                {group.memberIds.length} agents
              </span>
            </Link>
          ))}
        </Card>
      )}
      {creating ? (
        <GroupDialog
          onClose={() => setCreating(false)}
          onSaved={(group) => navigate(groupPath(group.id))}
        />
      ) : null}
    </div>
  );
}
