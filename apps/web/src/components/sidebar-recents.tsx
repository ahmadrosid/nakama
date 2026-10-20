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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { Input } from "@nakama/ui/input";
import { cn } from "@nakama/ui/utils";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  Search01Icon,
} from "hugeicons-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLocalStorageFlag } from "@/hooks/use-sidebar-collapsed";
import {
  getInitialPinnedCollapsed,
  SIDEBAR_PINNED_COLLAPSED_KEY,
} from "@/lib/sidebar";

/**
 * The Recents building blocks the sidebar shares between an agent's chats and
 * a group's sessions.
 */
export type SessionTarget = { id: string; title: string };

export interface RecentRowItem {
  /** Still responding: the title shimmers. */
  active?: boolean;
  href: string;
  id: string;
  pinned: boolean;
  title: string;
}

const SKELETON_ROW_WIDTHS = ["w-3/4", "w-1/2", "w-2/3"] as const;

export function RecentChatsDialogs({
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

export function SessionRowSkeletons() {
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

export function RecentChatRow({
  item,
  onRename,
  onDelete,
  onTogglePin,
}: {
  item: RecentRowItem;
  onRename: (target: SessionTarget) => void;
  onDelete: (target: SessionTarget) => void;
  onTogglePin: () => void;
}) {
  const location = useLocation();
  const { href, id, title } = item;
  const current = location.pathname === href;

  return (
    <div className="group relative flex min-w-0 items-center">
      <Link
        aria-current={current ? "page" : undefined}
        className="sidebar-nav-link min-w-0 flex-1 px-2 py-1.5 group-focus-within:pr-[60px] group-hover:pr-[60px]"
        data-active={current || undefined}
        title={item.active ? `${title} (still responding)` : title}
        to={href}
      >
        <span className="sidebar-chat-title-clip min-w-0 flex-1 overflow-hidden">
          <span
            className={cn(
              "sidebar-chat-title block w-max whitespace-nowrap",
              item.active && "ai-rainbow-text"
            )}
          >
            {title}
          </span>
        </span>
      </Link>
      <div className="absolute right-1 flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`More actions for ${title}`}
                className="size-7 text-muted-foreground hover:bg-black/10 dark:hover:bg-transparent"
                size="icon-sm"
                title="More actions"
                variant="ghost"
              />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onRename({ id, title })}>
              <PencilEdit02Icon aria-hidden="true" className="size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete({ id, title })}
            >
              <Delete02Icon aria-hidden="true" className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          aria-label={item.pinned ? `Unpin ${title}` : `Pin ${title}`}
          className="size-7 text-muted-foreground hover:bg-black/10 dark:hover:bg-transparent"
          onClick={onTogglePin}
          size="icon-sm"
          title={item.pinned ? "Unpin" : "Pin"}
          variant="ghost"
        >
          {item.pinned ? (
            <PinOffIcon aria-hidden="true" className="size-4" />
          ) : (
            <PinIcon aria-hidden="true" className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function RecentChatSearch({
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

export function PinnedChats<T>({
  rows,
  renderRow,
}: {
  rows: T[];
  renderRow: (row: T) => ReactNode;
}) {
  const { collapsed: pinnedCollapsed, toggle: togglePinned } =
    useLocalStorageFlag(
      SIDEBAR_PINNED_COLLAPSED_KEY,
      getInitialPinnedCollapsed
    );

  return rows.length > 0 ? (
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
        <div className="min-h-0 overflow-hidden">{rows.map(renderRow)}</div>
      </div>
    </div>
  ) : null;
}

/** "Recents" with its collapse chevron and a new-chat shortcut. */
export function RecentsHeader({
  collapsed,
  newChatHref,
  onToggle,
}: {
  collapsed: boolean;
  newChatHref: string;
  onToggle: () => void;
}) {
  return (
    <div className="group mb-1.5 flex shrink-0 items-center gap-1 px-2">
      <button
        aria-expanded={!collapsed}
        className="sidebar-nav-group-label mb-0 w-auto gap-1.5 px-0 text-sm"
        onClick={onToggle}
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
          render={<Link to={newChatHref} />}
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
  );
}
