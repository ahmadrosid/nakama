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
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  StopIcon,
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

/** Wide screens: example messages float as cards around the heading. */
const FLOATING_CARD =
  "absolute w-64 rounded-2xl border bg-background px-4 py-3.5 text-sm shadow-md";

function FloatingExample() {
  return (
    <section aria-label="Example group" className="@4xl:contents hidden">
      <p className={`${FLOATING_CARD} top-12 left-8 -rotate-3`}>
        <span className="mb-1 block text-muted-foreground text-xs">You</span>
        <Mention>@all</Mention> write a short post about our new pricing
      </p>
      <div
        className={`${FLOATING_CARD} top-14 right-8 flex rotate-[2.5deg] gap-2.5`}
      >
        <ExampleAvatar
          className="size-7 bg-primary/15 text-primary text-xs"
          letter="R"
        />
        <p>
          <span className="block font-semibold">Researcher</span>I found 3 key
          facts. <Mention>@Writer</Mention>, they are yours.
        </p>
      </div>
      <div
        className={`${FLOATING_CARD} bottom-10 left-12 flex rotate-2 gap-2.5`}
      >
        <ExampleAvatar
          className="size-7 bg-primary text-primary-foreground text-xs"
          letter="W"
        />
        <p>
          <span className="block font-semibold">Writer</span>Draft done. 140
          words, ready for review.
          <span className="mt-1 block font-medium text-primary text-xs">
            2 replies in thread
          </span>
        </p>
      </div>
      <p className="absolute right-14 bottom-20 flex -rotate-2 items-center gap-2.5 rounded-xl bg-foreground px-3.5 py-2.5 text-background text-sm shadow-md">
        <span className="size-2 rounded-full bg-primary" />
        Writer is working
        <span className="ml-1 flex items-center gap-1.5 rounded-lg bg-background/15 px-2.5 py-1 text-xs">
          <StopIcon className="size-3" />
          Stop
        </span>
      </p>
    </section>
  );
}

/** An agent message styled like a `GroupMessageList` row. */
function ExampleAgentMessage({
  avatar,
  children,
  name,
  thread,
}: {
  avatar: ReactNode;
  children: ReactNode;
  name: string;
  thread?: string;
}) {
  return (
    <div className="mt-3 flex items-end gap-2">
      {avatar}
      <div className="flex min-w-0 max-w-[75%] flex-col items-start gap-1">
        <div className="px-3.5 text-muted-foreground text-xs">{name}</div>
        <p className="rounded-[1.25rem] rounded-bl-md bg-muted px-3.5 py-2 text-sm">
          {children}
        </p>
        {thread ? (
          <span className="ml-1 font-medium text-primary text-xs">
            {thread}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Narrow screens: the same example laid out like the group message list. */
function ChatExample() {
  return (
    <section
      aria-label="Example group"
      className="flex @4xl:hidden w-full max-w-sm flex-col rounded-2xl border px-3 py-4"
    >
      <div className="pb-3 text-center text-muted-foreground text-xs">
        Today 9:41 AM
      </div>
      <p className="w-fit max-w-[75%] self-end rounded-[1.25rem] rounded-br-md bg-[#0b84fe] px-3.5 py-2 text-sm text-white">
        <span className="font-medium">@all</span> write a short post about our
        new pricing
      </p>
      <ExampleAgentMessage
        avatar={
          <ExampleAvatar
            className="size-7 bg-primary/15 text-primary text-xs"
            letter="R"
          />
        }
        name="Researcher"
      >
        I found 3 key facts. <Mention>@Writer</Mention>, they are yours.
      </ExampleAgentMessage>
      <ExampleAgentMessage
        avatar={
          <ExampleAvatar
            className="size-7 bg-primary text-primary-foreground text-xs"
            letter="W"
          />
        }
        name="Writer"
        thread="2 replies in thread"
      >
        Draft done. 140 words, ready for review.
      </ExampleAgentMessage>
    </section>
  );
}

function GroupsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="@container my-6" id="agent-groups-empty">
      <div className="relative flex @4xl:min-h-[40rem] flex-col items-center @4xl:justify-center gap-8 overflow-hidden px-4 @4xl:py-0 py-10">
        <section className="relative z-10 flex max-w-lg flex-col items-center gap-5 text-center">
          <h2 className="text-balance font-bold text-4xl tracking-tight sm:text-5xl">
            Your agents, working as a team
          </h2>
          <p className="text-balance text-lg text-muted-foreground">
            Give a group one brief. Ask one with @name, or everyone with @all.
          </p>
          <Button
            className="rounded-full"
            id="btn-new-group"
            onClick={onCreate}
            size="lg"
          >
            <PlusSignIcon className="size-4" />
            New group
          </Button>
        </section>
        <ChatExample />
        <FloatingExample />
      </div>
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
