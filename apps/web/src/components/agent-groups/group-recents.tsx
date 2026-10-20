import type { AgentGroupSession } from "@nakama/core/agent-groups";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  PinnedChats,
  RecentChatRow,
  RecentChatSearch,
  RecentChatsDialogs,
  RecentsHeader,
  SessionRowSkeletons,
  type SessionTarget,
} from "@/components/sidebar-recents";
import {
  useDeleteGroupSession,
  useGroupSessionsQuery,
  useUpdateGroupSession,
} from "@/hooks/use-agent-groups";
import { useLocalStorageFlag } from "@/hooks/use-sidebar-collapsed";
import { groupPath } from "@/lib/navigation";
import {
  getInitialRecentsCollapsed,
  SIDEBAR_RECENTS_COLLAPSED_KEY,
} from "@/lib/sidebar";

/** The sidebar's Recents while a group is open: that group's sessions. */
export function GroupRecents({ groupId }: { groupId: string }) {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    data: sessions = [],
    error,
    isLoading,
  } = useGroupSessionsQuery(groupId);

  const updateSession = useUpdateGroupSession(groupId);
  const deleteSession = useDeleteGroupSession(groupId);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionTarget | null>(null);

  const { collapsed, toggle } = useLocalStorageFlag(
    SIDEBAR_RECENTS_COLLAPSED_KEY,
    getInitialRecentsCollapsed
  );

  // A group holds few sessions, so titles are searched on the page.
  const query = search.trim().toLowerCase();

  const recent = sessions.filter(
    (session) =>
      !session.pinned && (!query || session.title.toLowerCase().includes(query))
  );

  const renderSession = (session: AgentGroupSession) => (
    <RecentChatRow
      item={{
        active: session.active,
        href: groupPath(groupId, session.id),
        id: session.id,
        pinned: session.pinned,
        title: session.title,
      }}
      key={session.id}
      onDelete={setDeleteTarget}
      onRename={setRenameTarget}
      onTogglePin={() =>
        updateSession.mutate({
          changes: { pinned: !session.pinned },
          sessionId: session.id,
        })
      }
    />
  );

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col" id="group-recents">
      <PinnedChats
        renderRow={renderSession}
        rows={sessions.filter((session) => session.pinned)}
      />
      <RecentsHeader
        collapsed={collapsed}
        newChatHref={groupPath(groupId)}
        onToggle={toggle}
      />
      {!collapsed && sessions.length > 0 ? (
        <RecentChatSearch
          onChange={setSearch}
          search={search}
          searchQuery={query}
        />
      ) : null}
      {collapsed ? null : (
        <div className="no-scrollbar min-h-0 overflow-y-auto">
          {isLoading && <SessionRowSkeletons />}
          {error && (
            <p
              className="px-3 py-2 text-muted-foreground text-xs"
              role="status"
            >
              Couldn’t load recent chats.
            </p>
          )}
          {!(isLoading || error) && recent.length === 0 && (
            <p className="px-3 py-2 text-muted-foreground text-xs">
              {query ? "No chats match" : "No recent chats"}
            </p>
          )}
          {recent.map(renderSession)}
        </div>
      )}
      <RecentChatsDialogs
        deleteTarget={deleteTarget}
        onDelete={async () => {
          if (!deleteTarget) {
            return;
          }

          await deleteSession.mutateAsync(deleteTarget.id);

          if (location.pathname === groupPath(groupId, deleteTarget.id)) {
            navigate(groupPath(groupId), { replace: true });
          }

          setDeleteTarget(null);
        }}
        onRename={async (event) => {
          event.preventDefault();
          const title = renameTarget?.title.trim();

          if (!(renameTarget && title) || updateSession.isPending) {
            return;
          }

          await updateSession.mutateAsync({
            changes: { title },
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
