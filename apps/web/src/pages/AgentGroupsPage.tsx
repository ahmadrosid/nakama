import type { ProfileSummary } from "@nakama/core";
import type { AgentGroup } from "@nakama/core/agent-groups";
import { Button } from "@nakama/ui";
import { ConfirmDialog } from "@nakama/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import {
  ArrowUp02Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  Tick02Icon,
} from "hugeicons-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GroupAvatar } from "@/components/agent-groups/GroupAvatar";
import { GroupDialog } from "@/components/agent-groups/group-dialog";
import { useAgentGroupsQuery, useDeleteGroup } from "@/hooks/use-agent-groups";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { groupPath } from "@/lib/navigation";

const MINUTE_MS = 60_000;

const HOUR_MS = 60 * MINUTE_MS;

const DAY_MS = 24 * HOUR_MS;

/** "2m", "1h", "Yesterday", a weekday within the week, else a short date. */
function formatListTime(value: string): string {
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();

  if (Number.isNaN(elapsed)) {
    return "";
  }

  if (elapsed < MINUTE_MS) {
    return "now";
  }

  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m`;
  }

  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h`;
  }

  if (elapsed < 2 * DAY_MS) {
    return "Yesterday";
  }

  if (elapsed < 7 * DAY_MS) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }

  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function lastMessagePreview(
  group: AgentGroup,
  profiles: ProfileSummary[]
): string {
  const last = group.lastMessage;

  if (!last) {
    return "No messages yet";
  }

  const author = last.authorProfileId
    ? (profiles.find((profile) => profile.id === last.authorProfileId)?.name ??
      "Agent")
    : "You";

  return `${author}: ${last.content.replace(/\s+/g, " ").trim()}`;
}

function Mention({ children }: { children: ReactNode }) {
  return <span className="font-medium text-primary">{children}</span>;
}

const GROUP_FEATURES = [
  "Add any agents and give them one brief",
  "Ask one with @name, or everyone with @all",
  "Agents pass work to each other; you can stop them",
  "Keep side topics in threads",
];

function ExampleAvatar({
  className,
  letter,
}: {
  className: string;
  letter: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${className}`}
    >
      {letter}
    </span>
  );
}

/** An agent message laid out like `GroupMessageList`. */
function ExampleReply({
  author,
  avatar,
  children,
}: {
  author: string;
  avatar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mt-4 flex gap-2.5">
      {avatar}
      <div className="flex min-w-0 max-w-[85%] flex-col items-start gap-1">
        <div className="px-1 font-medium text-13 text-foreground">{author}</div>
        <p className="rounded-2xl bg-muted px-4 py-2.5 text-sm">{children}</p>
      </div>
    </div>
  );
}

function GroupsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center gap-12 py-10 sm:py-16"
      id="agent-groups-empty"
    >
      <section className="flex flex-[1_1_20rem] flex-col gap-5">
        <h2 className="text-balance font-bold text-3xl tracking-tight sm:text-4xl">
          Your agents, working as a team
        </h2>
        <ul className="flex flex-col gap-3.5 text-foreground/80">
          {GROUP_FEATURES.map((feature) => (
            <li className="flex gap-3" key={feature}>
              <Tick02Icon className="mt-0.5 size-5 shrink-0 text-primary" />
              {feature}
            </li>
          ))}
        </ul>
        <div>
          <Button id="btn-new-group" onClick={onCreate} size="lg">
            <PlusSignIcon className="size-4" />
            New group
          </Button>
        </div>
      </section>
      <section
        aria-label="Example group"
        className="flex min-w-0 flex-[1_1_26rem] flex-col overflow-hidden rounded-2xl border bg-background shadow-xs"
      >
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <span className="truncate font-semibold text-lg tracking-tight">
            Content team
          </span>
          <span className="flex shrink-0 -space-x-2">
            <ExampleAvatar
              className="size-7 bg-primary/15 text-primary text-xs"
              letter="R"
            />
            <ExampleAvatar
              className="size-7 bg-primary text-primary-foreground text-xs"
              letter="W"
            />
          </span>
          <span className="shrink-0 text-muted-foreground text-sm">
            2 agents
          </span>
        </div>
        <div className="flex flex-col p-4">
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm">
            <Mention>@all</Mention> write a short post about our new pricing
          </p>
          <ExampleReply
            author="Researcher"
            avatar={
              <ExampleAvatar
                className="mt-0.5 size-7 bg-primary/15 text-primary text-xs"
                letter="R"
              />
            }
          >
            I found 3 key facts. <Mention>@Writer</Mention>, they are yours.
          </ExampleReply>
          <ExampleReply
            author="Writer"
            avatar={
              <ExampleAvatar
                className="mt-0.5 size-7 bg-primary text-primary-foreground text-xs"
                letter="W"
              />
            }
          >
            Draft done. 140 words, ready for review.
          </ExampleReply>
          <span className="mt-1 ml-10.5 font-medium text-primary text-xs">
            2 replies in thread
          </span>
        </div>
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 rounded-xl border py-2 pr-2 pl-4 shadow-xs">
            <span className="flex-1 truncate text-muted-foreground text-sm">
              Message the group, @mention an agent or @all
            </span>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <ArrowUp02Icon className="size-4" />
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function filterGroups(
  groups: AgentGroup[],
  profiles: ProfileSummary[],
  query: string
): AgentGroup[] {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return groups;
  }

  return groups.filter(
    (group) =>
      group.name.toLowerCase().includes(needle) ||
      group.memberIds.some((id) =>
        profiles
          .find((profile) => profile.id === id)
          ?.name.toLowerCase()
          .includes(needle)
      )
  );
}

function GroupRow({
  group,
  onDelete,
  onEdit,
  profiles,
}: {
  group: AgentGroup;
  onDelete: (group: AgentGroup) => void;
  onEdit: (group: AgentGroup) => void;
  profiles: ProfileSummary[];
}) {
  return (
    <div
      className="flex items-center rounded-xl pr-2 transition-colors hover:bg-muted/60"
      key={group.id}
    >
      <Link
        className="flex min-w-0 flex-1 items-center gap-4 py-3 pl-4"
        to={groupPath(group.id)}
      >
        <GroupAvatar className="size-11" group={group} profiles={profiles} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-semibold text-base">
              {group.name}
            </span>
            <span className="shrink-0 text-muted-foreground text-sm">
              {group.memberIds.length} agents
            </span>
          </span>
          <span className="truncate text-muted-foreground text-sm">
            {lastMessagePreview(group, profiles)}
          </span>
        </span>
        {group.lastMessage ? (
          <span className="shrink-0 self-start pt-1 text-muted-foreground text-sm">
            {formatListTime(group.lastMessage.createdAt)}
          </span>
        ) : null}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`${group.name} actions`}
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(group)}>
            <PencilEdit02Icon />
            Edit group
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onDelete(group)}
            variant="destructive"
          >
            <Delete02Icon />
            Delete group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function GroupList({
  groups,
  isLoading,
  onDelete,
  onEdit,
  profiles,
  total,
}: {
  groups: AgentGroup[];
  isLoading: boolean;
  onDelete: (group: AgentGroup) => void;
  onEdit: (group: AgentGroup) => void;
  profiles: ProfileSummary[];
  total: number;
}) {
  if (isLoading) {
    return (
      <div className="flex min-h-32 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground text-sm">
        {total === 0 ? "No groups yet" : "No matching groups"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1" id="agent-group-list">
      {groups.map((group) => (
        <GroupRow
          group={group}
          key={group.id}
          onDelete={onDelete}
          onEdit={onEdit}
          profiles={profiles}
        />
      ))}
    </div>
  );
}

function GroupsToolbar({
  onCreate,
  onQueryChange,
  query,
}: {
  onCreate: () => void;
  onQueryChange: (query: string) => void;
  query: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="relative flex-1">
        <Search01Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search groups or agents"
          className="h-10 pl-9"
          id="agent-groups-search"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search groups or agents"
          value={query}
        />
      </div>
      <Button className="h-10" id="btn-new-group" onClick={onCreate}>
        <PlusSignIcon className="size-4" />
        New group
      </Button>
    </div>
  );
}

export function AgentGroupsPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data: groups = [], isLoading } = useAgentGroupsQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const [editing, setEditing] = useState<AgentGroup | null>(null);
  const [deleting, setDeleting] = useState<AgentGroup | null>(null);
  const deleteGroup = useDeleteGroup();
  const [query, setQuery] = useState("");
  const visible = filterGroups(groups, profiles, query);

  const empty = !isLoading && groups.length === 0;

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-4 ${empty ? "max-w-5xl" : "max-w-3xl"}`}
      id="agent-groups-page"
    >
      {empty ? (
        <GroupsEmptyState onCreate={() => setCreating(true)} />
      ) : (
        <GroupsToolbar
          onCreate={() => setCreating(true)}
          onQueryChange={setQuery}
          query={query}
        />
      )}
      {empty ? null : (
        <GroupList
          groups={visible}
          isLoading={isLoading}
          onDelete={setDeleting}
          onEdit={setEditing}
          profiles={profiles}
          total={groups.length}
        />
      )}
      {creating ? (
        <GroupDialog
          onClose={() => setCreating(false)}
          onSaved={(group) => navigate(groupPath(group.id))}
        />
      ) : null}
      {editing ? (
        <GroupDialog group={editing} onClose={() => setEditing(null)} />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          description={`Delete "${deleting.name}" with all its chats? This cannot be undone.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteGroup.mutateAsync(deleting.id);
          }}
          title="Delete group?"
        />
      ) : null}
    </div>
  );
}
