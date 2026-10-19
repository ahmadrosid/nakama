import type { SessionSummary } from "@nakama/core/contract";
import { useEffect, useRef, useState } from "react";
import {
  RecentChatRow,
  type SessionTarget,
} from "@/components/SidebarRecentChatRow";
import {
  useSetSessionOrderMutation,
  useUpdateSessionMutation,
} from "@/hooks/use-resource-mutations";

export function useRecentChatTree(
  profileId: string,
  sessions: SessionSummary[],
  onRename: (target: SessionTarget) => void,
  onDelete: (target: SessionTarget) => void
) {
  const setSessionOrder = useSetSessionOrderMutation();
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const pointerDraggedId = useRef<string | null>(null);
  useEffect(() => {
    const clear = () => {
      pointerDraggedId.current = null;
    };

    document.addEventListener("pointerup", clear);
    document.addEventListener("pointercancel", clear);

    return () => {
      document.removeEventListener("pointerup", clear);
      document.removeEventListener("pointercancel", clear);
    };
  }, []);

  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(
    new Set()
  );

  const updateSession = useUpdateSessionMutation();
  const recentSessions = sessions.filter((session) => !session.pinned);
  const localPositions = new Map(localOrder?.map((id, index) => [id, index]));

  const orderedRecent = [...recentSessions].sort((a, b) => {
    if (localOrder) {
      return (
        (localPositions.get(a.id) ?? Number.POSITIVE_INFINITY) -
        (localPositions.get(b.id) ?? Number.POSITIVE_INFINITY)
      );
    }

    if (a.sortPosition === null) {
      return b.sortPosition === null ? 0 : -1;
    }

    if (b.sortPosition === null) {
      return 1;
    }

    return a.sortPosition - b.sortPosition;
  });

  const recentIds = new Set(orderedRecent.map((session) => session.id));

  const parentOf = (session: SessionSummary) =>
    session.parentSessionId && recentIds.has(session.parentSessionId)
      ? session.parentSessionId
      : null;

  const childrenByParent = new Map<string | null, SessionSummary[]>();

  for (const session of orderedRecent) {
    const parentId = parentOf(session);
    const children = childrenByParent.get(parentId) ?? [];
    children.push(session);
    childrenByParent.set(parentId, children);
  }

  const siblingsOf = (session: SessionSummary) =>
    childrenByParent.get(parentOf(session)) ?? [];

  const saveMovedChat = (
    sourceId: string,
    targetId: string,
    after: boolean
  ) => {
    if (sourceId === targetId || setSessionOrder.isPending) {
      return;
    }

    const source = orderedRecent.find((session) => session.id === sourceId);
    const target = orderedRecent.find((session) => session.id === targetId);

    if (!(source && target) || parentOf(source) !== parentOf(target)) {
      return;
    }

    const ids = orderedRecent
      .map((session) => session.id)
      .filter((id) => id !== sourceId);

    ids.splice(ids.indexOf(targetId) + Number(after), 0, sourceId);
    setLocalOrder(ids);
    void setSessionOrder.mutateAsync({ profileId, sessionIds: ids }).then(
      () => setLocalOrder(null),
      () => setLocalOrder(null)
    );
  };

  const renderSession = (
    session: (typeof sessions)[number],
    depth = 0,
    childCount = 0
  ) => (
    <RecentChatRow
      canMoveDown={siblingsOf(session).at(-1)?.id !== session.id}
      canMoveUp={siblingsOf(session)[0]?.id !== session.id}
      childCount={childCount}
      collapsed={collapsedBranches.has(session.id)}
      depth={depth}
      key={session.id}
      onDelete={onDelete}
      onDetach={
        session.parentSessionId
          ? () =>
              void updateSession.mutateAsync({
                input: { parentSessionId: null },
                profileId,
                sessionId: session.id,
              })
          : undefined
      }
      onDropChat={
        session.pinned
          ? undefined
          : (sourceId, after) => saveMovedChat(sourceId, session.id, after)
      }
      onMove={
        session.pinned
          ? undefined
          : (direction) => {
              const siblings = siblingsOf(session);

              const index = siblings.findIndex(
                (item) => item.id === session.id
              );

              const target = siblings[index + (direction === "up" ? -1 : 1)];

              if (target) {
                saveMovedChat(session.id, target.id, direction === "down");
              }
            }
      }
      onPointerDropChat={
        session.pinned
          ? undefined
          : (after) => {
              if (pointerDraggedId.current) {
                saveMovedChat(pointerDraggedId.current, session.id, after);
              }
            }
      }
      onPointerStartDrag={() => {
        pointerDraggedId.current = session.id;
      }}
      onRename={onRename}
      onToggleCollapse={() =>
        setCollapsedBranches((current) => {
          const next = new Set(current);

          if (next.has(session.id)) {
            next.delete(session.id);
          } else {
            next.add(session.id);
          }

          return next;
        })
      }
      onTogglePin={() =>
        void updateSession.mutateAsync({
          input: { pinned: !session.pinned },
          profileId,
          sessionId: session.id,
        })
      }
      profileId={profileId}
      session={session}
      sortable={!session.pinned}
    />
  );

  const renderTree = (parentId: string | null, depth = 0): React.ReactNode =>
    childrenByParent.get(parentId)?.map((session, index, siblings) => {
      const children = childrenByParent.get(session.id) ?? [];

      return (
        <div className="relative" key={session.id}>
          {depth > 0 ? (
            index === siblings.length - 1 ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-0 left-0 h-[18px] w-3 rounded-bl-md border-border/60 border-b border-l"
              />
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 border-border/60 border-l"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-[17px] left-0 w-3 border-border/60 border-t"
                />
              </>
            )
          ) : null}
          {renderSession(session, depth, children.length)}
          {!collapsedBranches.has(session.id) && children.length > 0 ? (
            <div className="ml-4">{renderTree(session.id, depth + 1)}</div>
          ) : null}
        </div>
      );
    });

  return {
    orderError: setSessionOrder.error,
    orderedRecent,
    renderSession,
    renderTree,
  };
}
