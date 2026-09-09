import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CubeIcon,
} from "hugeicons-react";
import type { ElementType } from "react";
import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/context/use-auth";
import { usePrefetchAppData } from "@/hooks/use-app-queries";
import { useAutomationUnreadTotal } from "@/hooks/use-automations";
import { useOrgPlugins } from "@/hooks/use-plugins";
import {
  useSidebarCollapsed,
  useSystemNavCollapsed,
} from "@/hooks/use-sidebar-collapsed";
import { chatProfileIdFromPath } from "@/lib/chat-history";
import {
  enabledPluginNavEntries,
  type NavGroup,
  type NavItem,
  navHrefForPage,
  type PageId,
  pageIdFromPath,
  pluginIdFromPath,
  visibleNavGroups,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";

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
  const { data: orgPlugins = [] } = useOrgPlugins();
  const pluginNav = useMemo(
    () => enabledPluginNavEntries(orgPlugins),
    [orgPlugins]
  );
  const activePluginId = pluginIdFromPath(location.pathname);
  const prefetchAppData = usePrefetchAppData();
  const { data: automationUnreadTotal = 0 } = useAutomationUnreadTotal();
  const { collapsed: shellCollapsed, toggle } = useSidebarCollapsed();
  const { collapsed: systemNavCollapsed, toggle: toggleSystemNav } =
    useSystemNavCollapsed();
  const collapsed = variant === "shell" && shellCollapsed;
  const navGroups = useMemo(
    () =>
      visibleNavGroups({
        isPlatformAdmin: user?.isPlatformAdmin === true,
        orgRole: activeOrg?.role,
      }),
    [activeOrg?.role, user?.isPlatformAdmin]
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
      <nav className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
        {navGroups.map((group) => (
          <SidebarNavGroup
            chatProfileId={chatProfileIdFromPath(location.pathname)}
            collapsed={collapsed}
            group={group}
            key={group.id}
            page={page}
            prefetchAppData={prefetchAppData}
            systemNavCollapsed={systemNavCollapsed}
            toggleSystemNav={toggleSystemNav}
            unreadTotal={automationUnreadTotal}
          />
        ))}
        <PluginsNavGroup
          activePluginId={activePluginId}
          collapsed={collapsed}
          entries={pluginNav}
        />
      </nav>
    </aside>
  );
}

function PluginsNavGroup({
  entries,
  collapsed,
  activePluginId,
}: {
  entries: { href: string; label: string; pluginId: string }[];
  collapsed: boolean;
  activePluginId: string | null;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div aria-label="Plugins" className="sidebar-nav-group" role="group">
      {collapsed ? null : <p className="sidebar-nav-group-label">Plugins</p>}
      <div className="sidebar-nav-group-items">
        {entries.map((entry) => (
          <SidebarNavButton
            active={entry.pluginId === activePluginId}
            collapsed={collapsed}
            icon={CubeIcon}
            item={{
              description: entry.pluginId,
              icon: CubeIcon,
              id: "plugins",
              label: entry.label,
            }}
            key={entry.pluginId}
            to={entry.href}
          />
        ))}
      </div>
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

function SidebarNavGroup({
  chatProfileId,
  collapsed,
  group,
  page,
  prefetchAppData,
  systemNavCollapsed,
  toggleSystemNav,
  unreadTotal,
}: {
  chatProfileId: string | null;
  collapsed: boolean;
  group: NavGroup;
  page: PageId;
  prefetchAppData: () => void;
  systemNavCollapsed: boolean;
  toggleSystemNav: () => void;
  unreadTotal: number;
}) {
  const containsActive =
    group.collapsible === true && group.items.some((item) => item.id === page);
  const groupExpanded = !systemNavCollapsed || containsActive;
  // Icon rail always shows every destination; tree collapse only
  // applies when labels are visible.
  const itemsVisible = !group.collapsible || collapsed || groupExpanded;

  return (
    <div
      aria-label={group.label}
      className="sidebar-nav-group"
      data-items-hidden={itemsVisible ? undefined : true}
      data-tree={group.collapsible || undefined}
      role="group"
    >
      {group.collapsible && !collapsed ? (
        <button
          aria-expanded={groupExpanded}
          className="sidebar-nav-group-label"
          onClick={() => {
            if (groupExpanded && containsActive) {
              return;
            }
            toggleSystemNav();
          }}
          type="button"
        >
          <ArrowDown01Icon
            aria-hidden="true"
            className={cn(
              "sidebar-nav-group-chevron",
              !groupExpanded && "-rotate-90"
            )}
            strokeWidth={1.75}
          />
          <span className="truncate">{group.label}</span>
        </button>
      ) : null}
      <div
        aria-hidden={!itemsVisible}
        className="sidebar-nav-group-items"
        inert={itemsVisible ? undefined : true}
      >
        {group.items.map((item) => (
          <SidebarNavButton
            active={item.id === page}
            badge={item.id === "automations" ? unreadTotal : undefined}
            collapsed={collapsed}
            icon={item.icon}
            item={item}
            key={item.id}
            onPrefetch={item.id === "automations" ? prefetchAppData : undefined}
            to={
              item.id === "soul"
                ? `${navHrefForPage(item.id, chatProfileId)}?tab=tools`
                : navHrefForPage(item.id, chatProfileId)
            }
          />
        ))}
      </div>
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
          className="sidebar-nav-label ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 font-semibold text-2xs text-primary-foreground tabular-nums"
        >
          {badgeLabel}
        </span>
      ) : null}
    </Link>
  );
}
