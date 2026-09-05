import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from "hugeicons-react";
import type { ElementType } from "react";
import { useMemo } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { CommandPalette } from "@/components/CommandPalette";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { ProfileRail } from "@/components/ProfileRail";
import { RouteBoundary } from "@/components/RouteBoundary";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ActiveChatProfileProvider } from "@/context/active-chat-profile-context";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import { usePrefetchAppData } from "@/hooks/use-app-queries";
import { useAutomationUnreadTotal } from "@/hooks/use-automations";
import {
  useSidebarCollapsed,
  useSystemNavCollapsed,
} from "@/hooks/use-sidebar-collapsed";
import { chatProfileIdFromPath } from "@/lib/chat-history";
import {
  findNavItem,
  type NavGroup,
  type NavItem,
  navHrefForPage,
  PAGE_PATHS,
  type PageId,
  pageIdFromPath,
  visibleNavGroups,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { AgentWorkTabs } from "@/pages/automations/agent-work-tabs";

export function Layout() {
  const shell = useAppShell();

  return (
    <TooltipProvider delay={0}>
      <ActiveChatProfileProvider>
        <div className="flex h-svh overflow-hidden bg-background max-sm:hidden">
          <ProfileRail />
          <AppShellSidebar shell={shell} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <AppShellHeader label={shell.activeNav?.label} page={shell.page} />
            <AppShellError error={shell.error} />
            <main className={appShellMainClassName(shell.page, shell.pathname)}>
              <RouteBoundary resetKey={shell.pathname}>
                <Outlet />
              </RouteBoundary>
            </main>
          </div>
        </div>
        <NarrowViewportNotice />
        <CommandPalette />
      </ActiveChatProfileProvider>
    </TooltipProvider>
  );
}

function useAppShell() {
  const location = useLocation();
  const page = pageIdFromPath(location.pathname) ?? "chat";
  const { error } = useAppContext();
  const { user, activeOrg } = useAuth();
  const prefetchAppData = usePrefetchAppData();
  const { data: automationUnreadTotal = 0 } = useAutomationUnreadTotal();
  const { collapsed, toggle } = useSidebarCollapsed();
  const { collapsed: systemNavCollapsed, toggle: toggleSystemNav } =
    useSystemNavCollapsed();
  const navGroups = useMemo(
    () =>
      visibleNavGroups({
        isPlatformAdmin: user?.isPlatformAdmin === true,
        orgRole: activeOrg?.role,
      }),
    [activeOrg?.role, user?.isPlatformAdmin]
  );

  return {
    activeNav: findNavItem(page),
    automationUnreadTotal,
    chatProfileId: chatProfileIdFromPath(location.pathname),
    collapsed,
    error,
    navGroups,
    page,
    pathname: location.pathname,
    prefetchAppData,
    systemNavCollapsed,
    toggle,
    toggleSystemNav,
  };
}

type AppShellState = ReturnType<typeof useAppShell>;

function isFlushContentPage(page: PageId, pathname: string): boolean {
  return (
    page === "chat" ||
    page === "automations" ||
    page === "files" ||
    pathname.startsWith(`${PAGE_PATHS.soul}/playground/`)
  );
}

function appShellMainClassName(page: PageId, pathname: string): string {
  const flush = isFlushContentPage(page, pathname);
  const skillDetail = pathname.startsWith(`${PAGE_PATHS.profiles}/skills/`);
  return cn(
    "min-h-0 flex-1",
    flush ? "flex flex-col overflow-hidden" : "overflow-y-auto",
    flush || skillDetail ? null : "p-6"
  );
}

function AppShellSidebar({ shell }: { shell: AppShellState }) {
  return (
    <aside
      aria-label="Main navigation"
      className="sidebar-shell flex h-full shrink-0 flex-col overflow-hidden border-border/50 border-r"
      data-collapsed={shell.collapsed || undefined}
    >
      <SidebarHeader collapsed={shell.collapsed} onToggle={shell.toggle} />
      <nav className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
        {shell.navGroups.map((group) => (
          <SidebarNavGroup
            chatProfileId={shell.chatProfileId}
            collapsed={shell.collapsed}
            group={group}
            key={group.id}
            page={shell.page}
            prefetchAppData={shell.prefetchAppData}
            systemNavCollapsed={shell.systemNavCollapsed}
            toggleSystemNav={shell.toggleSystemNav}
            unreadTotal={shell.automationUnreadTotal}
          />
        ))}
      </nav>
    </aside>
  );
}

function SidebarHeader({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
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
      <SidebarCollapseButton onToggle={onToggle} />
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

function AppShellHeader({
  label,
  page,
}: {
  label: string | undefined;
  page: PageId;
}) {
  if (page === "chat") {
    return null;
  }

  const hideTitle = page === "soul" || page === "profiles";
  return (
    <header className="app-shell-header gap-4 bg-card px-6">
      {page === "automations" ? (
        <AgentWorkTabs />
      ) : hideTitle ? null : (
        <h1 className="type-brand min-w-0 truncate">{label}</h1>
      )}
      <div
        className={cn(
          "flex h-full shrink-0 items-stretch gap-2",
          !hideTitle && "ml-auto"
        )}
        data-page-header-actions
      />
    </header>
  );
}

function AppShellError({ error }: { error: string | null | undefined }) {
  if (!error) {
    return null;
  }

  return (
    <div className="shrink-0 border-red-200 border-b bg-red-50 px-6 py-3 text-red-800 text-sm dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
      {error}
    </div>
  );
}

/**
 * The rail and sidebar cost a fixed 296px. Measured on the settings page, that
 * leaves 344px of content at 640px wide and 79px at 375px, with labels clipped
 * and the page scrolling sideways. Tablets at `sm` (640px) can use the shell;
 * below that we say so instead of rendering a layout nobody can use.
 */
function NarrowViewportNotice() {
  return (
    <div className="hidden h-svh flex-col items-center justify-center gap-3 bg-background px-6 text-center max-sm:flex">
      <h1 className="type-page-title">This console needs a wider window</h1>
      <p className="max-w-sm text-muted-foreground text-sm">
        Profiles, tools and integrations are laid out for a screen at least
        640px wide. Open Nakama on a tablet or desktop browser, or widen this
        window.
      </p>
      <p className="max-w-sm text-muted-foreground text-sm">
        To chat with your agent from a phone, use the Telegram, WhatsApp or
        Discord bridge instead.
      </p>
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

  const link = (
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

  if (!collapsed) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>
        {showBadge ? `${item.label} (${badge} unread)` : item.label}
      </TooltipContent>
    </Tooltip>
  );
}
