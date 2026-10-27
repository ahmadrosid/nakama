import { ContextMenu } from "@base-ui/react/context-menu";
import type { SessionSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { toast } from "@nakama/ui/toast";
import { cn } from "@nakama/ui/utils";
import {
  ArrowDown02Icon,
  ArrowMoveUpLeftIcon,
  ArrowUp02Icon,
  Delete02Icon,
  Link01Icon,
  LinkSquare02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
} from "hugeicons-react";
import { Link, useLocation } from "react-router-dom";
import { buildChatPath } from "@/lib/chat-history";

export type SessionTarget = { id: string; title: string };

type RecentChatMenuProps = {
  id: string;
  pinned: boolean;
  title: string;
  href: string;
  onRename: (target: SessionTarget) => void;
  onDelete: (target: SessionTarget) => void;
  onTogglePin: () => void;
  onDetach?: () => void;
  onMove?: (direction: "up" | "down") => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
};

// Shared by the "More actions" dropdown and the right-click menu.
function RecentChatMenuItems({
  id,
  pinned,
  title,
  href,
  onRename,
  onDelete,
  onTogglePin,
  onDetach,
  onMove,
  canMoveUp = false,
  canMoveDown = false,
}: RecentChatMenuProps) {
  const url = new URL(href, window.location.origin).href;

  return (
    <>
      <DropdownMenuItem onClick={() => window.open(url, "_blank", "noopener")}>
        <LinkSquare02Icon aria-hidden="true" className="size-4" />
        Open in new tab
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast("Link copied");
          } catch {
            toast("Could not copy link");
          }
        }}
      >
        <Link01Icon aria-hidden="true" className="size-4" />
        Copy link
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onRename({ id, title })}>
        <PencilEdit02Icon aria-hidden="true" className="size-4" />
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onTogglePin}>
        {pinned ? (
          <PinOffIcon aria-hidden="true" className="size-4" />
        ) : (
          <PinIcon aria-hidden="true" className="size-4" />
        )}
        {pinned ? "Unpin" : "Pin"}
      </DropdownMenuItem>
      {onDetach ? (
        <DropdownMenuItem onClick={onDetach}>
          <ArrowMoveUpLeftIcon aria-hidden="true" className="size-4" />
          Detach from parent
        </DropdownMenuItem>
      ) : null}
      {onMove && (canMoveUp || canMoveDown) ? (
        <>
          <DropdownMenuSeparator />
          {canMoveUp ? (
            <DropdownMenuItem onClick={() => onMove("up")}>
              <ArrowUp02Icon aria-hidden="true" className="size-4" />
              Move up
            </DropdownMenuItem>
          ) : null}
          {canMoveDown ? (
            <DropdownMenuItem onClick={() => onMove("down")}>
              <ArrowDown02Icon aria-hidden="true" className="size-4" />
              Move down
            </DropdownMenuItem>
          ) : null}
        </>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => onDelete({ id, title })}
        variant="destructive"
      >
        <Delete02Icon aria-hidden="true" className="size-4" />
        Delete
      </DropdownMenuItem>
    </>
  );
}

/** Right-click, a long press on touch, or Shift+F10 opens the chat actions. */
export function RecentChatContextMenu({
  className,
  children,
  ...menu
}: RecentChatMenuProps & { className?: string; children: React.ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger className={className}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="isolate z-50 outline-none">
          <ContextMenu.Popup className="z-50 min-w-48 whitespace-nowrap rounded-lg bg-popover p-1 text-popover-foreground shadow-md outline-none ring-1 ring-foreground/10">
            <RecentChatMenuItems {...menu} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function RecentChatActions(props: RecentChatMenuProps) {
  return (
    <div className="flex shrink-0 items-center p-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`More actions for ${props.title}`}
              className="size-7 text-muted-foreground opacity-0 hover:bg-black/10 focus-visible:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100 dark:hover:bg-transparent [@media(hover:none)]:opacity-100"
              size="icon-sm"
              title="More actions"
              variant="ghost"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-auto min-w-48 whitespace-nowrap"
        >
          <RecentChatMenuItems {...props} />
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
  depth = 0,
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
  depth?: number;
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

  const menu = {
    canMoveDown,
    canMoveUp,
    href,
    id: session.id,
    onDelete,
    onDetach,
    onMove,
    onRename,
    onTogglePin,
    pinned: Boolean(session.pinned),
    title,
  };

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
      <RecentChatContextMenu
        {...menu}
        className="sidebar-chat-row group/row flex min-w-0 flex-1 items-center rounded-md"
      >
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
        <RecentChatActions {...menu} />
      </RecentChatContextMenu>
    </div>
  );
}
