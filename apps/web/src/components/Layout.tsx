import type { LucideIcon } from "lucide-react";
import {
  ChevronsLeftIcon,
  ChevronsRightIcon,
  LogOutIcon,
} from "lucide-react";
import type { SVGProps } from "react";
import { useMemo } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppContext } from "@/context/app-context";
import { useAuth } from "@/context/auth-context";
import { OrgSwitcher } from "@/components/OrgSwitcher";
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
  SETTINGS_NAV_ITEM,
  type NavItem,
} from "@/lib/navigation";

const GITHUB_REPO_URL = "https://github.com/ahmadrosid/nakama";

export function Layout() {
  const location = useLocation();
  const page = pageIdFromPath(location.pathname) ?? "chat";
  const chatProfileId = chatProfileIdFromPath(location.pathname);
  const { error } = useAppContext();
  const { logout, user, activeOrg } = useAuth();
  const prefetchAppData = usePrefetchAppData();
  const { data: automationUnreadTotal = 0 } = useAutomationUnreadTotal();
  const { collapsed, toggle } = useSidebarCollapsed();
  const activeNav = findNavItem(page);
  const navGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.id === "soul") {
            return canAccessSystemPage(user?.isPlatformAdmin === true, activeOrg?.role);
          }

          if (item.id === "integrations") {
            return canAccessIntegrationsPage(activeOrg?.role);
          }

          return (
            !PLATFORM_ADMIN_PAGE_IDS.has(item.id) || user?.isPlatformAdmin === true
          );
        }),
      })).filter((group) => group.items.length > 0),
    [activeOrg?.role, user?.isPlatformAdmin],
  );

  return (
    <TooltipProvider delay={0}>
      <div className="flex h-svh overflow-hidden bg-background">
        <aside
          aria-label="Main navigation"
          data-collapsed={collapsed || undefined}
          className={cn(
            "flex h-full shrink-0 flex-col overflow-hidden border-r border-border/50 bg-sidebar transition-[width] duration-200 ease-out motion-reduce:transition-none",
            collapsed ? "w-14" : "w-60",
          )}
        >
          <div
            className={cn(
              "app-shell-header",
              collapsed ? "h-auto min-h-14 flex-col gap-2 px-2 py-3" : "gap-2.5 px-3",
            )}
          >
            <img
              src="/nakama.png"
              alt="Nakama"
              className="size-8 shrink-0 rounded-lg object-contain"
            />
            {!collapsed ? (
              <p className="type-brand min-w-0 flex-1 truncate">Nakama</p>
            ) : null}
            {!collapsed ? <GitHubRepoButton /> : null}
            <SidebarCollapseButton collapsed={collapsed} onToggle={toggle} />
          </div>

          <div className={cn("shrink-0 pt-4", collapsed ? "px-2 pb-2" : "px-3 pb-3")}>
            <OrgSwitcher collapsed={collapsed} />
          </div>

          <nav
            className={cn(
              "no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto",
              collapsed ? "p-2" : "p-3",
            )}
          >
            {navGroups.map((group, groupIndex) => (
              <div key={group.id}>
                {groupIndex > 0 ? (
                  <div className="sidebar-nav-divider" aria-hidden="true" />
                ) : null}
                <div
                  className="sidebar-nav-group"
                  role="group"
                  aria-label={group.label}
                >
                  {!collapsed ? (
                    <p className="sidebar-nav-group-label">{group.label}</p>
                  ) : null}
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
              </div>
            ))}
          </nav>

          <div
            className={cn(
              "sidebar-nav-footer flex shrink-0 border-t border-border/50",
              collapsed ? "flex-col justify-center gap-1 px-2 py-2.5" : "items-center gap-2 px-3 py-3",
            )}
          >
            <SidebarNavButton
              item={SETTINGS_NAV_ITEM}
              icon={NAV_ITEM_ICONS.settings}
              active={page === "settings"}
              collapsed={collapsed}
              to={navHrefForPage("settings")}
              onPrefetch={prefetchAppData}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground/70 hover:text-foreground"
                  onClick={() => {
                    void logout();
                  }}
                >
                  <LogOutIcon className="sidebar-nav-icon" strokeWidth={1.75} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {user?.email ?? "Log out"}
              </TooltipContent>
            </Tooltip>
          </div>
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
            className={
              page === "chat" ||
              page === "tasks" ||
              location.pathname.startsWith(`${PAGE_PATHS.soul}/playground/`)
                ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                : "min-h-0 flex-1 overflow-y-auto p-6"
            }
          >
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function GitHubRepoButton() {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Open GitHub repository"
      title="Open GitHub repository"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-[min(var(--radius-md),12px)] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
    >
      <GitHubMark className="sidebar-nav-icon" aria-hidden="true" />
    </a>
  );
}

function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.38 7.86 10.9.58.11.79-.25.79-.56v-2.02c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.69 1.25 3.34.96.1-.75.4-1.25.72-1.54-2.56-.29-5.24-1.28-5.24-5.71 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.19 1.18a11.1 11.1 0 0 1 5.8 0c2.22-1.49 3.18-1.18 3.18-1.18.64 1.58.24 2.75.12 3.04.74.8 1.19 1.82 1.19 3.08 0 4.44-2.69 5.42-5.25 5.71.41.36.77 1.07.77 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function SidebarCollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const CollapseIcon = collapsed ? ChevronsRightIcon : ChevronsLeftIcon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      onClick={onToggle}
      className={cn(
        "shrink-0 text-muted-foreground/70 hover:text-foreground",
        collapsed && "size-9 rounded-md hover:bg-sidebar-accent/60",
        !collapsed && "ml-auto",
      )}
    >
      <CollapseIcon className="sidebar-nav-icon" strokeWidth={1.75} />
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
      {!collapsed ? (
        <>
          <span className="min-w-0 truncate">{item.label}</span>
          {showBadge ? (
            <span
              className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary-foreground"
              aria-hidden
            >
              {badgeLabel}
            </span>
          ) : null}
        </>
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
