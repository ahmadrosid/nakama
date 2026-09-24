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
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  Search01Icon,
} from "hugeicons-react";
import type { ElementType } from "react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAuth } from "@/context/use-auth";
import { usePrefetchAppData, useProfilesQuery } from "@/hooks/use-app-queries";
import { useAutomationUnreadTotal } from "@/hooks/use-automations";
import {
  useDeleteSessionMutation,
  useHistorySessionsQuery,
  useUpdateSessionMutation,
} from "@/hooks/use-resource-mutations";
import {
  useLocalStorageFlag,
  useSidebarCollapsed,
} from "@/hooks/use-sidebar-collapsed";
import {
  buildChatPath,
  chatProfileIdFromPath,
  resolveRecentChatsProfileId,
} from "@/lib/chat-history";
import {
  type NavItem,
  navHrefForPage,
  pageIdFromPath,
  SIDEBAR_PAGE_IDS,
  visibleNavGroups,
} from "@/lib/navigation";
import { sessionSearchQuery } from "@/lib/session-list";
import {
  getInitialRecentsCollapsed,
  SIDEBAR_RECENTS_COLLAPSED_KEY,
} from "@/lib/sidebar";

export function AppSidebar({
  variant = "shell",
}: {
  /** `drawer` is the copy inside the mobile navigation drawer, where
   * collapsing is pointless because the panel is dismissed instead. */
  variant?: "drawer" | "shell";
}) {
  const location = useLocation();
  const page = pageIdFromPath(location.pathname) ?? "chat";
  const { user, activeOrg } = useAuth();
  const prefetchAppData = usePrefetchAppData();
  const { data: automationUnreadTotal = 0 } = useAutomationUnreadTotal();
  const { collapsed: shellCollapsed, toggle } = useSidebarCollapsed();
  const collapsed = variant === "shell" && shellCollapsed;
  const items = visibleNavGroups({
    isPlatformAdmin: user?.isPlatformAdmin === true,
    orgRole: activeOrg?.role,
  })
    .flatMap((group) => group.items)
    .filter((item) => SIDEBAR_PAGE_IDS.includes(item.id));

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        "sidebar-shell flex h-full shrink-0 flex-col overflow-hidden border-border/50 border-r",
        variant === "drawer" && "w-full border-r-0"
      )}
      data-collapsed={collapsed || undefined}
    >
      <SidebarHeader
        collapsed={collapsed}
        collapsible={variant === "shell"}
        onToggle={toggle}
      />
      <nav className="flex min-h-0 flex-1 flex-col">
        <div className="sidebar-nav-group-items shrink-0">
          {items.map((item) => (
            <SidebarNavButton
              active={
                item.id === "customize"
                  ? page === "customize" || !SIDEBAR_PAGE_IDS.includes(page)
                  : item.id === page &&
                    (page !== "chat" ||
                      !chatProfileIdFromPath(location.pathname))
              }
              badge={
                item.id === "automations" ? automationUnreadTotal : undefined
              }
              collapsed={collapsed}
              icon={item.icon}
              item={item}
              key={item.id}
              onPrefetch={
                item.id === "automations" ? prefetchAppData : undefined
              }
              to={navHrefForPage(
                item.id,
                chatProfileIdFromPath(location.pathname)
              )}
            />
          ))}
        </div>
        {collapsed ? null : <RecentChats />}
      </nav>
    </aside>
  );
}

const SKELETON_ROW_WIDTHS = ["w-3/4", "w-1/2", "w-2/3"] as const;

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

function RecentChats() {
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
  const history = useHistorySessionsQuery(profileId);
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
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const { collapsed, toggle } = useLocalStorageFlag(
    SIDEBAR_RECENTS_COLLAPSED_KEY,
    getInitialRecentsCollapsed
  );
  const pinnedSessions = sessions.filter((session) => session.pinned);
  const recentSessions = sessions.filter((session) => !session.pinned);
  const renderSession = (session: (typeof sessions)[number]) => {
    const href = buildChatPath(profileId, session.id);
    const title = session.title?.trim() || "Untitled chat";
    return (
      <div
        className="group relative flex min-w-0 items-center"
        key={session.id}
      >
        <Link
          aria-current={location.pathname === href ? "page" : undefined}
          className="sidebar-nav-link min-w-0 flex-1 px-2 py-1.5 transition-[padding] group-focus-within:pr-24 group-hover:pr-24"
          data-active={location.pathname === href || undefined}
          title={session.active ? `${title} (still responding)` : title}
          to={href}
        >
          <span className={cn("truncate", session.active && "ai-rainbow-text")}>
            {title}
          </span>
        </Link>
        <div className="absolute right-1 flex translate-x-2 items-center opacity-0 transition-[opacity,transform] group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:translate-x-0 group-hover:opacity-100">
          <Button
            aria-label={`Rename ${title}`}
            className="size-7 text-muted-foreground"
            onClick={() =>
              setRenameTarget({
                id: session.id,
                title,
              })
            }
            size="icon-sm"
            title="Rename"
            variant="ghost"
          >
            <PencilEdit02Icon aria-hidden="true" className="size-4" />
          </Button>
          <Button
            aria-label={session.pinned ? `Unpin ${title}` : `Pin ${title}`}
            className="size-7 text-muted-foreground"
            onClick={() =>
              void updateSession.mutateAsync({
                input: { pinned: !session.pinned },
                profileId,
                sessionId: session.id,
              })
            }
            size="icon-sm"
            title={session.pinned ? "Unpin" : "Pin"}
            variant="ghost"
          >
            {session.pinned ? (
              <PinOffIcon aria-hidden="true" className="size-4" />
            ) : (
              <PinIcon aria-hidden="true" className="size-4" />
            )}
          </Button>
          <Button
            aria-label={`Delete ${title}`}
            className="size-7 text-destructive"
            onClick={() =>
              setDeleteTarget({
                id: session.id,
                title,
              })
            }
            size="icon-sm"
            title="Delete"
            variant="ghost"
          >
            <Delete02Icon aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>
    );
  };

  const renderList = (rows: typeof sessions, emptyText: string) => (
    <div className="no-scrollbar min-h-0 overflow-y-auto">
      {list.isLoading && <SessionRowSkeletons />}
      {list.error && (
        <p className="px-3 py-2 text-muted-foreground text-xs" role="status">
          {searchQuery
            ? "Couldn’t search chats."
            : "Couldn’t load recent chats."}
        </p>
      )}
      {!(list.isLoading || list.error) && list.data.length === 0 && (
        <p className="px-3 py-2 text-muted-foreground text-xs">{emptyText}</p>
      )}
      {rows.map(renderSession)}
      {isFetchingNextPage && <SessionRowSkeletons />}
      {hasNextPage && <div aria-hidden="true" ref={setPageEnd} />}
    </div>
  );

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="relative mb-3 shrink-0">
        <Search01Icon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search chats"
          className="border-border/60 bg-muted/20 pl-8 shadow-none"
          maxLength={MAX_SESSION_SEARCH_LENGTH}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSearch("");
            }
          }}
          placeholder="Search chats"
          type="search"
          value={search}
        />
      </div>
      {searchQuery ? renderList(results.data, "No chats match") : null}
      {!searchQuery && pinnedSessions.length > 0 ? (
        <div className="mb-3">
          <p className="sidebar-nav-group-label px-2 text-sm">Pinned</p>
          {pinnedSessions.map(renderSession)}
        </div>
      ) : null}
      <div
        className="mb-1.5 flex shrink-0 items-center gap-1 px-2"
        hidden={Boolean(searchQuery)}
      >
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
              "sidebar-nav-group-chevron size-3.5",
              collapsed && "-rotate-90"
            )}
            strokeWidth={1.75}
          />
        </button>
        <div className="ml-auto flex items-center gap-1">
          <Button
            aria-label="New chat"
            className="text-muted-foreground/55"
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
      {searchQuery || collapsed
        ? null
        : renderList(recentSessions, "No recent chats")}
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
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (updateSession.isPending) {
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
            >
              <Input
                autoFocus
                onChange={(event) =>
                  setRenameTarget((current) =>
                    current
                      ? { ...current, title: event.target.value }
                      : current
                  )
                }
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
            await deleteSession.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          }}
          title="Delete chat?"
        />
      ) : null}
    </div>
  );
}

function SidebarHeader({
  collapsed,
  collapsible,
  onToggle,
}: {
  collapsed: boolean;
  collapsible: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    return (
      <div className="app-shell-header">
        <CollapsedOrgExpandControl onExpand={onToggle} />
      </div>
    );
  }

  return (
    <div className="app-shell-header">
      <div className="flex min-w-0 flex-1">
        <OrgSwitcher collapsed={false} />
      </div>
      {collapsible ? <SidebarCollapseButton onToggle={onToggle} /> : null}
    </div>
  );
}

function CollapsedOrgExpandControl({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="group relative flex size-9 shrink-0 items-center justify-center self-center">
      <div className="transition-opacity duration-150 group-focus-within:pointer-events-none group-focus-within:opacity-0 group-hover:pointer-events-none group-hover:opacity-0">
        <OrgSwitcher collapsed />
      </div>
      <Button
        aria-label="Expand sidebar"
        className="absolute inset-0 size-9 rounded-md p-0 text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-sidebar-accent/55 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        onClick={onExpand}
        title="Expand sidebar"
        type="button"
        variant="ghost"
      >
        <ArrowRight01Icon className="size-4" strokeWidth={1.75} />
      </Button>
    </div>
  );
}

function SidebarCollapseButton({ onToggle }: { onToggle: () => void }) {
  return (
    <Button
      aria-expanded
      aria-label="Collapse sidebar"
      className="shrink-0 self-center text-muted-foreground hover:text-foreground"
      onClick={onToggle}
      size="icon-sm"
      title="Collapse sidebar"
      type="button"
      variant="ghost"
    >
      <ArrowLeft01Icon className="size-4" strokeWidth={1.75} />
    </Button>
  );
}

function SidebarNavButton({
  item,
  icon,
  active,
  collapsed,
  to,
  onPrefetch,
  badge,
  className,
}: {
  item: NavItem;
  icon: ElementType;
  active: boolean;
  collapsed: boolean;
  to: string;
  onPrefetch?: () => void;
  badge?: number;
  className?: string;
}) {
  const link = (
    <SidebarNavLink
      active={active}
      badge={badge}
      className={className}
      collapsed={collapsed}
      icon={icon}
      item={item}
      onPrefetch={onPrefetch}
      to={to}
    />
  );

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>
        {badge && badge > 0 ? `${item.label} (${badge} unread)` : item.label}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarNavLink({
  item,
  icon: Icon,
  active,
  collapsed,
  to,
  onPrefetch,
  badge,
  className,
}: {
  item: NavItem;
  icon: ElementType;
  active: boolean;
  collapsed: boolean;
  to: string;
  onPrefetch?: () => void;
  badge?: number;
  className?: string;
}) {
  const showBadge = Boolean(badge && badge > 0);
  const badgeLabel = badge && badge > 99 ? "99+" : String(badge ?? "");

  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={
        showBadge
          ? `${item.label}, ${badge} unread automation run${badge === 1 ? "" : "s"}`
          : item.label
      }
      className={cn(
        "sidebar-nav-link",
        collapsed && "sidebar-nav-link--collapsed",
        className
      )}
      data-active={active || undefined}
      onFocus={onPrefetch}
      onMouseEnter={onPrefetch}
      title={collapsed ? undefined : item.description}
      to={to}
    >
      <span className="relative shrink-0">
        <Icon
          aria-hidden="true"
          className="sidebar-nav-icon"
          strokeWidth={1.75}
        />
        {showBadge && collapsed ? (
          <span
            aria-hidden
            className="absolute top-0 right-0 inline-flex h-[18px] min-w-[18px] translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-sidebar bg-primary px-1.5 font-bold text-2xs text-primary-foreground tabular-nums leading-none shadow-sm"
          >
            {badgeLabel}
          </span>
        ) : null}
      </span>
      <span className="sidebar-nav-label truncate">{item.label}</span>
      {showBadge && !collapsed ? (
        <span
          aria-hidden
          className="sidebar-nav-label ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground tabular-nums leading-none"
        >
          {badgeLabel}
        </span>
      ) : null}
    </Link>
  );
}
