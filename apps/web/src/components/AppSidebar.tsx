import { Button } from "@nakama/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  PencilEdit02Icon,
} from "hugeicons-react";
import type { ElementType } from "react";
import { Link, useLocation } from "react-router-dom";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAuth } from "@/context/use-auth";
import { usePrefetchAppData, useProfilesQuery } from "@/hooks/use-app-queries";
import { useAutomationUnreadTotal } from "@/hooks/use-automations";
import { useHistorySessionsQuery } from "@/hooks/use-resource-mutations";
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
  const {
    data: sessions,
    isLoading,
    error,
  } = useHistorySessionsQuery(profileId);
  const { collapsed, toggle } = useLocalStorageFlag(
    SIDEBAR_RECENTS_COLLAPSED_KEY,
    getInitialRecentsCollapsed
  );

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex shrink-0 items-center gap-1 px-2">
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
      {!collapsed && (
        <div className="no-scrollbar min-h-0 overflow-y-auto">
          {isLoading && (
            <p className="px-3 py-2 text-muted-foreground text-xs">
              Loading chats…
            </p>
          )}
          {error && (
            <p
              className="px-3 py-2 text-muted-foreground text-xs"
              role="status"
            >
              Couldn’t load recent chats.
            </p>
          )}
          {!(isLoading || error) && sessions.length === 0 && (
            <p className="px-3 py-2 text-muted-foreground text-xs">
              No recent chats
            </p>
          )}
          {sessions.slice(0, 15).map((session) => {
            const href = buildChatPath(profileId, session.id);
            const title = session.title?.trim() || "Untitled chat";
            return (
              <Link
                aria-current={location.pathname === href ? "page" : undefined}
                className="sidebar-nav-link px-2 py-1.5"
                data-active={location.pathname === href || undefined}
                key={session.id}
                title={title}
                to={href}
              >
                <span className="truncate">{title}</span>
              </Link>
            );
          })}
        </div>
      )}
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
