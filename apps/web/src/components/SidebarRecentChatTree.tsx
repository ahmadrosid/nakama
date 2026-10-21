import type { SessionSummary } from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  RecentChatRow,
  type SessionTarget,
} from "@/components/SidebarRecentChatRow";
import {
  useSetSessionOrderMutation,
  useUpdateSessionMutation,
} from "@/hooks/use-resource-mutations";

const DRAG_THRESHOLD_PX = 4;

const SLIDE_TRANSITION = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";

type ChatDrag = {
  id: string;
  active: boolean;
  startY: number;
  startTop: number;
  pointerY: number;
  initialSiblingIds: string[];
  siblingIds: string[];
  order: string[];
};

const pointerTop = (node: HTMLElement, clientY: number) => {
  const parent = node.offsetParent;

  if (!(parent instanceof HTMLElement)) {
    return clientY;
  }

  return (
    clientY -
    parent.getBoundingClientRect().top -
    parent.clientTop +
    parent.scrollTop
  );
};

export function useRecentChatTree(
  profileId: string,
  sessions: SessionSummary[],
  onRename: (target: SessionTarget) => void,
  onDelete: (target: SessionTarget) => void
) {
  const setSessionOrder = useSetSessionOrderMutation();
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<ChatDrag | null>(null);
  const slideFrom = useRef(new Map<string, number>());
  const blockClick = useRef(false);
  const saveCount = useRef(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);

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

  const saveOrder = (ids: string[]) => {
    saveCount.current += 1;
    const count = saveCount.current;

    const settle = () => {
      if (saveCount.current === count) {
        setLocalOrder(null);
      }
    };

    setLocalOrder(ids);
    void setSessionOrder
      .mutateAsync({ profileId, sessionIds: ids })
      .then(settle, settle);
  };

  const saveMovedChat = (
    sourceId: string,
    targetId: string,
    after: boolean
  ) => {
    if (sourceId === targetId) {
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
    saveOrder(ids);
  };

  const followPointer = () => {
    const current = drag.current;
    const node = current && nodes.current.get(current.id);

    if (!(current && node)) {
      return;
    }

    const offset =
      current.pointerY - current.startY - (node.offsetTop - current.startTop);

    node.style.transition = "none";
    node.style.transform = `translateY(${offset}px)`;
  };

  // Slide siblings from where they were drawn to their new slot (FLIP).
  useLayoutEffect(() => {
    for (const [id, fromTop] of slideFrom.current) {
      const node = nodes.current.get(id);

      if (!node) {
        continue;
      }

      node.style.transition = "none";
      node.style.transform = "";
      const delta = fromTop - node.getBoundingClientRect().top;

      if (delta !== 0) {
        node.style.transform = `translateY(${delta}px)`;
        node.getBoundingClientRect();
        node.style.transition = SLIDE_TRANSITION;
        node.style.transform = "";
      }
    }

    slideFrom.current.clear();
    followPointer();
  });

  const moveDraggedChat = (clientY: number) => {
    const current = drag.current;
    const node = current && nodes.current.get(current.id);

    if (!(current && node)) {
      return;
    }

    const y = pointerTop(node, clientY);
    const others = current.siblingIds.filter((id) => id !== current.id);

    const index = others.filter((id) => {
      const sibling = nodes.current.get(id);

      return sibling ? y > sibling.offsetTop + sibling.offsetHeight / 2 : false;
    }).length;

    const siblingIds = [...others];
    siblingIds.splice(index, 0, current.id);

    if (siblingIds.join() === current.siblingIds.join()) {
      return;
    }

    for (const id of others) {
      const sibling = nodes.current.get(id);

      if (sibling) {
        slideFrom.current.set(id, sibling.getBoundingClientRect().top);
      }
    }

    const group = new Set(siblingIds);
    let next = 0;

    const order = current.order.map((id) => {
      if (!group.has(id)) {
        return id;
      }

      next += 1;

      return siblingIds[next - 1] ?? id;
    });

    current.siblingIds = siblingIds;
    current.order = order;
    setLocalOrder(order);
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const current = drag.current;

      if (!current) {
        return;
      }

      current.pointerY = event.clientY;

      if (!current.active) {
        if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD_PX) {
          return;
        }

        current.active = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        setDraggingId(current.id);
      }

      followPointer();
      moveDraggedChat(event.clientY);
    };

    const finish = (event: PointerEvent) => {
      const current = drag.current;
      drag.current = null;

      if (!current?.active) {
        return;
      }

      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDraggingId(null);

      const node = nodes.current.get(current.id);

      if (node) {
        node.style.transition = SLIDE_TRANSITION;
        node.style.transform = "";
      }

      // The release after a drag must not open the chat.
      blockClick.current = event.type === "pointerup";

      const moved =
        current.siblingIds.join() !== current.initialSiblingIds.join();

      if (event.type === "pointerup" && moved) {
        saveOrder(current.order);
      } else {
        setLocalOrder(null);
      }
    };

    const resetClick = () => {
      blockClick.current = false;
    };

    const onClick = (event: MouseEvent) => {
      if (blockClick.current) {
        blockClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("pointerdown", resetClick, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);

    return () => {
      document.removeEventListener("pointerdown", resetClick, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
    };
  });

  const startDrag = (
    session: SessionSummary,
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    const node = nodes.current.get(session.id);

    if (!node || setSessionOrder.isPending) {
      return;
    }

    const siblingIds = siblingsOf(session).map((item) => item.id);

    drag.current = {
      active: false,
      id: session.id,
      initialSiblingIds: siblingIds,
      order: orderedRecent.map((item) => item.id),
      pointerY: event.clientY,
      siblingIds,
      startTop: node.offsetTop,
      startY: event.clientY,
    };
  };

  const renderSession = (session: (typeof sessions)[number], depth = 0) => (
    <RecentChatRow
      canMoveDown={siblingsOf(session).at(-1)?.id !== session.id}
      canMoveUp={siblingsOf(session)[0]?.id !== session.id}
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
      onPointerStartDrag={(event) => startDrag(session, event)}
      onRename={onRename}
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
        <div
          className={cn(
            "relative rounded-md",
            // Draw the drag card inset so it looks tighter than the row slot.
            draggingId === session.id &&
              "z-10 before:absolute before:inset-x-0 before:inset-y-1 before:-z-10 before:rounded-md before:bg-sidebar before:shadow-xs before:ring-1 before:ring-border/40 [&_.sidebar-chat-row]:bg-transparent!"
          )}
          key={session.id}
          ref={(node) => {
            if (node) {
              nodes.current.set(session.id, node);
            } else {
              nodes.current.delete(session.id);
            }
          }}
        >
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
          {renderSession(session, depth)}
          {children.length > 0 ? (
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
