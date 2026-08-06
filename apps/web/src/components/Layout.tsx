import type { LucideIcon } from "lucide-react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useMemo } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { ProfileRail } from "@/components/ProfileRail";
import { ActiveChatProfileProvider } from "@/context/active-chat-profile-context";
import { usePrefetchAppData } from "@/hooks/use-app-queries";
import { useAutomationUnreadTotal } from "@/hooks/use-automations";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { cn } from "@/lib/utils";
import { chatProfileIdFromPath } from "@/lib/chat-history";
import {
  findNavItem,
  navHrefForPage,
  NAV_GROUPS,
  NAV_ITEM_ICONS,
  canAccessSystemPage,
  canAccessIntegrationsPage,
  PAGE_PATHS,
  PLATFORM_ADMIN_PAGE_IDS,
  pageIdFromPath,
  type NavItem,
} from "@/lib/navigation";

export function Layout() {
  const location = useLocation();
  const page = pageIdFromPath(location.pathname) ?? "chat";
  const chatProfileId = chatProfileIdFromPath(location.pathname);
  const { error } = useAppContext();
  const { user, activeOrg } = useAuth();
  const prefetchAppData = usePrefetchAppData();
  const { data: automationUnreadTotal = 0 } = useAutomationUnreadTotal();
  const { collapsed, toggle } = useSidebarCollapsed();
  const activeNav = findNavItem(page);
  const navGroups = useMemo(() => {
    const groups: typeof NAV_GROUPS = [];

    for (const group of NAV_GROUPS) {
      const items = group.items.filter((item) => {
        if (item.id === "soul") {
          return canAccessSystemPage(user?.isPlatformAdmin === true, activeOrg?.role);
        }

        if (item.id === "integrations") {
          return canAccessIntegrationsPage(activeOrg?.role);
        }

        return (
          !PLATFORM_ADMIN_PAGE_IDS.has(item.id) || user?.isPlatformAdmin === true
        );
      });

      if (items.length > 0) {
        groups.push({ ...group, items });
      }
    }

    return groups;
  }, [activeOrg?.role, user?.isPlatformAdmin]);

  return (
    <TooltipProvider delay={0}>
      <ActiveChatProfileProvider>
        <div className="flex h-svh overflow-hidden bg-background">
          <ProfileRail />

        <aside
          aria-label="Main navigation"
          data-collapsed={collapsed || undefined}
          className="sidebar-shell flex h-full shrink-0 flex-col overflow-hidden border-r border-border/50"
        >
          <div className="app-shell-header">
            {collapsed ? (
              <CollapsedOrgExpandControl onExpand={toggle} />
            ) : (
              <>
                <div className="flex min-w-0 flex-1">
                  <OrgSwitcher collapsed={false} />
                </div>
                <SidebarCollapseButton onToggle={toggle} />
              </>
            )}
          </div>

          <nav className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
            {navGroups.map((group) => (
              <div
                key={group.id}
                className="sidebar-nav-group"
                role="group"
                aria-label={group.label}
              >
                <div className="sidebar-nav-group-items">
                  {group.items.map((item) => (
                    <SidebarNavButton
                      key={item.id}
                      item={item}
                      icon={NAV_ITEM_ICONS[item.id]}
                      active={item.id === page}
                      collapsed={collapsed}
                      badge={item.id === "automations" ? automationUnreadTotal : undefined}
                      to={
                        item.id === "soul"
                          ? `${navHrefForPage(item.id, chatProfileId)}?tab=tools`
                          : navHrefForPage(item.id, chatProfileId)
                      }
                      onPrefetch={
                        item.id === "automations" ? prefetchAppData : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {page !== "chat" ? (
            <header className="app-shell-header gap-4 bg-card px-6">
              <h1 className="type-brand min-w-0 truncate">{activeNav?.label}</h1>
            </header>
          ) : null}

          {error ? (
            <div className="shrink-0 border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}

          <main
            className={cn(
              "min-h-0 flex-1",
              page === "chat" ||
                page === "tasks" ||
                page === "automations" ||
                location.pathname.startsWith(`${PAGE_PATHS.soul}/playground/`)
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto",
              !location.pathname.startsWith(`${PAGE_PATHS.profiles}/skills/`) &&
                page !== "chat" &&
                page !== "tasks" &&
                page !== "automations" &&
                !location.pathname.startsWith(`${PAGE_PATHS.soul}/playground/`)
                ? "p-6"
                : null,
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>
      </ActiveChatProfileProvider>
    </TooltipProvider>
  );
}

function CollapsedOrgExpandControl({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="group relative flex size-9 shrink-0 items-center justify-center self-center">
      <div className="transition-opacity duration-150 group-hover:pointer-events-none group-hover:opacity-0 group-focus-within:pointer-events-none group-focus-within:opacity-0">
        <OrgSwitcher collapsed />
      </div>
      <Button
        type="button"
        variant="ghost"
        aria-label="Expand sidebar"
        title="Expand sidebar"
        onClick={onExpand}
        className="absolute inset-0 size-9 rounded-md p-0 text-muted-foreground/70 opacity-0 transition-opacity duration-150 hover:bg-sidebar-accent/55 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
      >
        <ChevronRightIcon className="size-4" strokeWidth={1.75} />
      </Button>
    </div>
  );
}

function SidebarCollapseButton({ onToggle }: { onToggle: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Collapse sidebar"
      aria-expanded
      title="Collapse sidebar"
      onClick={onToggle}
      className="shrink-0 self-center text-muted-foreground/70 hover:text-foreground"
    >
      <ChevronLeftIcon className="size-4" strokeWidth={1.75} />
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
  icon: LucideIcon;
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
      to={to}
      title={collapsed ? undefined : item.description}
      aria-label={
        showBadge ? `${item.label}, ${badge} unread automation run${badge === 1 ? "" : "s"}` : item.label
      }
      aria-current={active ? "page" : undefined}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      data-active={active || undefined}
      className={cn(
        "sidebar-nav-link",
        collapsed && "sidebar-nav-link--collapsed",
        className,
      )}
    >
      <span className="relative shrink-0">
        <Icon
          className="sidebar-nav-icon"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        {showBadge && collapsed ? (
          <span
            className="absolute right-0 top-0 inline-flex h-[18px] min-w-[18px] translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-sidebar bg-primary px-1.5 text-[10px] font-bold leading-none tabular-nums text-primary-foreground shadow-sm"
            aria-hidden
          >
            {badgeLabel}
          </span>
        ) : null}
      </span>
      <span className="sidebar-nav-label truncate">{item.label}</span>
      {showBadge && !collapsed ? (
        <span
          className="sidebar-nav-label ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary-foreground"
          aria-hidden
        >
          {badgeLabel}
        </span>
      ) : null}
    </Link>
  );

  if (!collapsed) {
    return link;
  }

  const tooltipLabel = showBadge
    ? `${item.label} (${badge} unread)`
    : item.label;

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  );
}
