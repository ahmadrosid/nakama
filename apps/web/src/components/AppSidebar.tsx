import { Button } from "@nakama/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import { ArrowLeft01Icon, ArrowRight01Icon } from "hugeicons-react";
import type { ElementType } from "react";
import { Link, useLocation } from "react-router-dom";
import { GroupRecents } from "@/components/agent-groups/group-recents";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { RecentChats } from "@/components/SidebarRecentChats";
import { useAuth } from "@/context/use-auth";
import { usePrefetchAppData } from "@/hooks/use-app-queries";
import { useAutomationUnreadTotal } from "@/hooks/use-automations";
import { useOrgPlugins } from "@/hooks/use-plugins";
import {
  usePinnedPlugins,
  useSidebarCollapsed,
} from "@/hooks/use-sidebar-collapsed";
import { chatProfileIdFromPath } from "@/lib/chat-history";
import {
  enabledPluginNavEntries,
  groupPath,
  groupRouteFromPath,
  type NavItem,
  navHrefForPage,
  PAGE_PATHS,
  pageIdFromPath,
  pluginIcon,
  pluginIdFromPath,
  SIDEBAR_PAGE_IDS,
  sidebarPageId,
  visibleNavGroups,
} from "@/lib/navigation";

export function AppSidebar({
  variant = "shell",
}: {
  /** `drawer` is the copy inside the mobile navigation drawer, where
   * collapsing is pointless because the panel is dismissed instead. */
  variant?: "drawer" | "shell";
}) {
  const location = useLocation();
  const page = sidebarPageId(pageIdFromPath(location.pathname) ?? "chat");
  const groupRoute = groupRouteFromPath(location.pathname);
  const { user, activeOrg } = useAuth();
  const prefetchAppData = usePrefetchAppData();
  const { data: automationUnreadTotal = 0 } = useAutomationUnreadTotal();
  const { collapsed: shellCollapsed, toggle } = useSidebarCollapsed({
    shortcut: variant === "shell",
  });
  const collapsed = variant === "shell" && shellCollapsed;

  const items = visibleNavGroups({
    isPlatformAdmin: user?.isPlatformAdmin === true,
    orgRole: activeOrg?.role,
  })
    .flatMap((group) => group.items)
    .filter((item) => SIDEBAR_PAGE_IDS.includes(item.id));

  const { data: orgPlugins = [] } = useOrgPlugins();
  const { pinned } = usePinnedPlugins();
  const pinnedIds = new Set(pinned);

  // Built from the enabled list, so a pin hides while its plugin is off.
  const pinnedPlugins = enabledPluginNavEntries(orgPlugins).filter((entry) =>
    pinnedIds.has(entry.pluginId)
  );

  const activePluginId = pluginIdFromPath(location.pathname);

  const onPinnedPlugin = pinnedPlugins.some(
    (entry) => entry.pluginId === activePluginId
  );

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
                  ? !onPinnedPlugin &&
                    (page === "customize" || !SIDEBAR_PAGE_IDS.includes(page))
                  : item.id === "chat"
                    ? groupRoute
                      ? !groupRoute.sessionId
                      : page === "chat" &&
                        !chatProfileIdFromPath(location.pathname)
                    : item.id === "groups"
                      ? location.pathname === PAGE_PATHS.groups
                      : item.id === page
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
              to={
                item.id === "chat" && groupRoute
                  ? groupPath(groupRoute.groupId)
                  : navHrefForPage(
                      item.id,
                      chatProfileIdFromPath(location.pathname)
                    )
              }
            />
          ))}
          {pinnedPlugins.map((entry) => (
            <SidebarNavButton
              active={entry.pluginId === activePluginId}
              collapsed={collapsed}
              icon={pluginIcon(entry.pluginId)}
              item={{
                description: entry.label,
                icon: pluginIcon(entry.pluginId),
                id: "plugins",
                label: entry.label,
              }}
              key={entry.pluginId}
              to={entry.href}
            />
          ))}
        </div>
        {collapsed ? null : groupRoute ? (
          <GroupRecents groupId={groupRoute.groupId} key={groupRoute.groupId} />
        ) : (
          <RecentChats />
        )}
      </nav>
    </aside>
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
