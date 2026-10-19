import type { SessionSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { cn } from "@nakama/ui/utils";
import {
  ArrowDown02Icon,
  ArrowUp02Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
} from "hugeicons-react";
import { Link, useLocation } from "react-router-dom";
import { buildChatPath } from "@/lib/chat-history";

export type SessionTarget = { id: string; title: string };

function RecentChatActions({
  session,
  title,
  onRename,
  onDelete,
  onTogglePin,
  onDetach,
  onMove,
  onToggleCollapse,
  collapsed,
  canMoveUp,
  canMoveDown,
}: {
  session: SessionSummary;
  title: string;
  onRename: (target: SessionTarget) => void;
  onDelete: (target: SessionTarget) => void;
  onTogglePin: () => void;
  onDetach?: () => void;
  onMove?: (direction: "up" | "down") => void;
  onToggleCollapse?: () => void;
  collapsed: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center p-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`More actions for ${title}`}
              className="size-7 text-muted-foreground opacity-0 hover:bg-black/10 focus-visible:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100 dark:hover:bg-transparent [@media(hover:none)]:opacity-100"
              size="icon-sm"
              title="More actions"
              variant="ghost"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onToggleCollapse ? (
            <DropdownMenuItem onClick={onToggleCollapse}>
              {collapsed ? "Expand branches" : "Collapse branches"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => onRename({ id: session.id, title })}>
            <PencilEdit02Icon aria-hidden="true" className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTogglePin}>
            {session.pinned ? (
              <PinOffIcon aria-hidden="true" className="size-4" />
            ) : (
              <PinIcon aria-hidden="true" className="size-4" />
            )}
            {session.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          {onDetach ? (
            <DropdownMenuItem onClick={onDetach}>
              Detach from parent
            </DropdownMenuItem>
          ) : null}
          {onMove ? (
            <>
              <DropdownMenuItem
                disabled={!canMoveUp}
                onClick={() => onMove("up")}
              >
                <ArrowUp02Icon aria-hidden="true" className="size-4" />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canMoveDown}
                onClick={() => onMove("down")}
              >
                <ArrowDown02Icon aria-hidden="true" className="size-4" />
                Move down
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => onDelete({ id: session.id, title })}
          >
            <Delete02Icon aria-hidden="true" className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function RecentChatRow({
  session,
  profileId,
  onRename,
  onDelete,
  onTogglePin,
  childCount = 0,
  collapsed = false,
  depth = 0,
  onToggleCollapse,
  onDetach,
  onMove,
  onPointerStartDrag,
  sortable = false,
  canMoveUp = false,
  canMoveDown = false,
}: {
  session: SessionSummary;
  profileId: string;
  onRename: (target: SessionTarget) => void;
  onDelete: (target: SessionTarget) => void;
  onTogglePin: () => void;
  childCount?: number;
  collapsed?: boolean;
  depth?: number;
  onToggleCollapse?: () => void;
  onDetach?: () => void;
  onMove?: (direction: "up" | "down") => void;
  onPointerStartDrag?: (event: React.PointerEvent<HTMLDivElement>) => void;
  sortable?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const location = useLocation();
  const href = buildChatPath(profileId, session.id);
  const title = session.title?.trim() || "Untitled chat";

  return (
    <div
      className={cn("relative flex min-w-0 items-center", depth > 0 && "pl-3")}
      onPointerDown={
        sortable
          ? (event) => {
              if (
                event.button === 0 &&
                event.target instanceof Element &&
                !event.target.closest("button")
              ) {
                onPointerStartDrag?.(event);
              }
            }
          : undefined
      }
    >
      <div className="sidebar-chat-row group/row flex min-w-0 flex-1 items-center rounded-md">
        <Link
          aria-current={location.pathname === href ? "page" : undefined}
          className="sidebar-nav-link min-w-0 flex-1 px-2 py-1.5"
          data-active={location.pathname === href || undefined}
          draggable={false}
          title={session.active ? `${title} (still responding)` : title}
          to={href}
        >
          <span className="sidebar-chat-title-clip min-w-0 flex-1 overflow-hidden">
            <span
              className={cn(
                "sidebar-chat-title block w-max whitespace-nowrap",
                session.active && "ai-rainbow-text"
              )}
            >
              {title}
            </span>
          </span>
        </Link>
        <RecentChatActions
          canMoveDown={canMoveDown}
          canMoveUp={canMoveUp}
          collapsed={collapsed}
          onDelete={onDelete}
          onDetach={onDetach}
          onMove={onMove}
          onRename={onRename}
          onToggleCollapse={childCount > 0 ? onToggleCollapse : undefined}
          onTogglePin={onTogglePin}
          session={session}
          title={title}
        />
      </div>
    </div>
  );
}
