import { MAX_SESSION_SEARCH_LENGTH } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { cn } from "@nakama/ui/utils";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  PencilEdit02Icon,
  Search01Icon,
} from "hugeicons-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { SessionTarget } from "@/components/SidebarRecentChatRow";
import { useRecentChatTree } from "@/components/SidebarRecentChatTree";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAuth } from "@/context/use-auth";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useDeleteSessionMutation,
  useHistorySessionsQuery,
  useUpdateSessionMutation,
} from "@/hooks/use-resource-mutations";
import { useLocalStorageFlag } from "@/hooks/use-sidebar-collapsed";
import {
  chatProfileIdFromPath,
  resolveRecentChatsProfileId,
} from "@/lib/chat-history";
import { navHrefForPage } from "@/lib/navigation";
import { sessionSearchQuery } from "@/lib/session-list";
import {
  getInitialPinnedCollapsed,
  getInitialRecentsCollapsed,
  SIDEBAR_PINNED_COLLAPSED_KEY,
  SIDEBAR_RECENTS_COLLAPSED_KEY,
} from "@/lib/sidebar";

const SKELETON_ROW_WIDTHS = ["w-3/4", "w-1/2", "w-2/3"] as const;

function RecentChatsDialogs({
  deleteTarget,
  onDelete,
  onRename,
  onRenameTitleChange,
  renameTarget,
  setDeleteTarget,
  setRenameTarget,
}: {
  deleteTarget: SessionTarget | null;
  onDelete: () => Promise<void>;
  onRename: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onRenameTitleChange: (title: string) => void;
  renameTarget: SessionTarget | null;
  setDeleteTarget: (target: SessionTarget | null) => void;
  setRenameTarget: (target: SessionTarget | null) => void;
}) {
  return (
    <>
      {renameTarget ? (
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              setRenameTarget(null);
            }
          }}
          open
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename chat</DialogTitle>
              <DialogDescription>
                Choose a name that helps you find this chat later.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(event) => void onRename(event)}>
              <Input
                autoFocus
                onChange={(event) => onRenameTitleChange(event.target.value)}
                value={renameTarget.title}
              />
              <DialogFooter className="mt-4">
                <Button
                  onClick={() => setRenameTarget(null)}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button disabled={!renameTarget.title.trim()} type="submit">
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          confirmLabel="Delete"
          description={`Delete "${deleteTarget.title}" permanently? This cannot be undone.`}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await onDelete();
          }}
          title="Delete chat?"
        />
      ) : null}
    </>
  );
}

function SessionRowSkeletons() {
  return (
    <div role="status">
      <span className="sr-only">Loading chats…</span>
      {SKELETON_ROW_WIDTHS.map((width) => (
        <div aria-hidden="true" className="px-2 py-2" key={width}>
          <div className={cn("skeleton-shimmer h-4 rounded", width)} />
        </div>
      ))}
    </div>
  );
}

function RecentChatSearch({
  search,
  searchQuery,
  onChange,
}: {
  search: string;
  searchQuery: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className={cn("relative shrink-0 px-2", searchQuery ? "mb-0" : "mb-3")}
    >
      {search ? (
        <button
          aria-label="Clear search"
          className="absolute top-1/2 right-4 -translate-y-1/2 text-muted-foreground"
          onClick={() => onChange("")}
          type="button"
        >
          <Cancel01Icon aria-hidden className="size-4" />
        </button>
      ) : (
        <Search01Icon
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-4.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
      )}
      <Input
        aria-label="Search chats"
        className="border-border/60 bg-white pr-8 pl-2 shadow-none focus-visible:border-border/60 focus-visible:ring-0"
        maxLength={MAX_SESSION_SEARCH_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onChange("");
          }
        }}
        placeholder="Search chats"
        type="text"
        value={search}
      />
    </div>
  );
}

function PinnedChats({
  sessions,
  renderSession,
}: {
  sessions: ReturnType<typeof useHistorySessionsQuery>["data"];
  renderSession: (
    session: ReturnType<typeof useHistorySessionsQuery>["data"][number]
  ) => React.ReactNode;
}) {
  const { collapsed: pinnedCollapsed, toggle: togglePinned } =
    useLocalStorageFlag(
      SIDEBAR_PINNED_COLLAPSED_KEY,
      getInitialPinnedCollapsed
    );

  return sessions.length > 0 ? (
    <div className="mb-3">
      <div className="group mb-1.5 flex shrink-0 items-center gap-1 px-2">
        <button
          aria-expanded={!pinnedCollapsed}
          className="sidebar-nav-group-label mb-0 w-auto gap-1.5 px-0 text-sm"
          onClick={togglePinned}
          type="button"
        >
          <span>Pinned</span>
          <ArrowDown01Icon
            aria-hidden="true"
            className={cn(
              "sidebar-nav-group-chevron size-3.5 opacity-0 transition-[opacity,transform] group-focus-within:opacity-100 group-hover:opacity-100",
              pinnedCollapsed && "-rotate-90"
            )}
            strokeWidth={1.75}
          />
        </button>
      </div>
      <div
        aria-hidden={pinnedCollapsed}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          pinnedCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        )}
        inert={pinnedCollapsed}
      >
        <div className="min-h-0 overflow-hidden">
          {sessions.map((session) => renderSession(session))}
        </div>
      </div>
    </div>
  ) : null;
}

export function RecentChats() {
  const location = useLocation();
  const { activeOrg } = useAuth();
  const { profileId: liveChatProfileId, orgId } = useActiveChatProfile();
  const { data: profiles = [] } = useProfilesQuery();

  const profileId =
    resolveRecentChatsProfileId({
      liveChatProfileId:
        chatProfileIdFromPath(location.pathname) ??
        (orgId === activeOrg?.id ? liveChatProfileId : null),
      orgId: activeOrg?.id,
      profiles,
      search: location.search,
    }) ?? "";

  const history = useHistorySessionsQuery(profileId, undefined, true);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // Typing waits a moment before asking the server; clearing is immediate.
  useEffect(() => {
    const next = sessionSearchQuery(search);

    if (!next) {
      setSearchQuery("");

      return;
    }

    const timer = setTimeout(() => setSearchQuery(next), 250);

    return () => clearTimeout(timer);
  }, [search]);
  // Idle until there is a search, then its own paged list.
  const results = useHistorySessionsQuery(profileId, searchQuery);
  const list = searchQuery ? results : history;
  const { data: sessions } = history;
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = list;
  const [pageEnd, setPageEnd] = useState<HTMLDivElement | null>(null);
  // Rebuilt after each page, because an observer reports only changes: a page
  // too short to push the sentinel out of view would otherwise be the last.
  useEffect(() => {
    if (!(pageEnd && hasNextPage) || isFetchingNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void fetchNextPage();
        }
      },
      // The list scrolls inside its own box, so that box is the root, and the
      // margin starts the next page a little before the end comes into view.
      { root: pageEnd.parentElement, rootMargin: "0px 0px 200px 0px" }
    );

    observer.observe(pageEnd);

    return () => observer.disconnect();
  }, [pageEnd, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const updateSession = useUpdateSessionMutation();
  const deleteSession = useDeleteSessionMutation();
  const [deleteTarget, setDeleteTarget] = useState<SessionTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionTarget | null>(null);

  const { collapsed, toggle } = useLocalStorageFlag(
    SIDEBAR_RECENTS_COLLAPSED_KEY,
    getInitialRecentsCollapsed
  );

  const pinnedSessions = sessions.filter((session) => session.pinned);

  const { orderedRecent, renderSession, renderTree, orderError } =
    useRecentChatTree(profileId, sessions, setRenameTarget, setDeleteTarget);

  const renderList = (rows: typeof sessions, emptyText: string | null) => (
    <div className="no-scrollbar min-h-0 overflow-y-auto">
      {list.isLoading && <SessionRowSkeletons />}
      {list.error && (
        <p className="px-3 py-2 text-muted-foreground text-xs" role="status">
          {searchQuery
            ? "Couldn’t search chats."
            : "Couldn’t load recent chats."}
        </p>
      )}
      {!(list.isLoading || list.error) && rows.length === 0 && emptyText && (
        <p className="px-3 py-2 text-muted-foreground text-xs">{emptyText}</p>
      )}
      {rows === orderedRecent
        ? renderTree(null)
        : rows.map((session) => renderSession(session))}
      {orderError && (
        <p className="px-3 text-destructive text-xs" role="status">
          Couldn’t save chat order.
        </p>
      )}
      {isFetchingNextPage && <SessionRowSkeletons />}
      {hasNextPage && <div aria-hidden="true" ref={setPageEnd} />}
    </div>
  );

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <PinnedChats renderSession={renderSession} sessions={pinnedSessions} />
      <div className="group mb-1.5 flex shrink-0 items-center gap-1 px-2">
        <button
          aria-expanded={!collapsed}
          className="sidebar-nav-group-label mb-0 w-auto gap-1.5 px-0 text-sm"
          onClick={toggle}
          type="button"
        >
          <span>Recents</span>
          <ArrowDown01Icon
            aria-hidden="true"
            className={cn(
              "sidebar-nav-group-chevron size-3.5 opacity-0 transition-[opacity,transform] group-focus-within:opacity-100 group-hover:opacity-100",
              collapsed && "-rotate-90"
            )}
            strokeWidth={1.75}
          />
        </button>
        <div className="ml-auto flex items-center gap-1">
          <Button
            aria-label="New chat"
            className="text-muted-foreground/55 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            nativeButton={false}
            render={<Link to={navHrefForPage("chat", profileId)} />}
            size="icon-sm"
            title="New chat"
            variant="ghost"
          >
            <PencilEdit02Icon
              aria-hidden="true"
              className="size-4"
              strokeWidth={1.75}
            />
          </Button>
        </div>
      </div>
      {!collapsed && sessions.length > 0 ? (
        <RecentChatSearch
          onChange={setSearch}
          search={search}
          searchQuery={searchQuery}
        />
      ) : null}
      {!collapsed && searchQuery
        ? renderList(
            results.data.filter((session) => !session.pinned),
            results.data.length === 0 ? "No chats match" : null
          )
        : null}
      {searchQuery || collapsed
        ? null
        : renderList(orderedRecent, "No recent chats")}
      <RecentChatsDialogs
        deleteTarget={deleteTarget}
        onDelete={async () => {
          if (!deleteTarget) {
            return;
          }

          await deleteSession.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onRename={async (event) => {
          event.preventDefault();

          if (!renameTarget || updateSession.isPending) {
            return;
          }

          const title = renameTarget.title.trim();

          if (!title) {
            return;
          }

          await updateSession.mutateAsync({
            input: { title },
            profileId,
            sessionId: renameTarget.id,
          });
          setRenameTarget(null);
        }}
        onRenameTitleChange={(title) =>
          setRenameTarget((current) =>
            current ? { ...current, title } : current
          )
        }
        renameTarget={renameTarget}
        setDeleteTarget={setDeleteTarget}
        setRenameTarget={setRenameTarget}
      />
    </div>
  );
}
