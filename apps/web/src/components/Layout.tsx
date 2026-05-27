import type { LucideIcon } from "lucide-react";
import { ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";
import { ConnectionBar } from "@/components/ConnectionBar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppContext } from "@/context/app-context";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import { usePrefetchAppData } from "@/hooks/use-app-queries";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { cn } from "@/lib/utils";
import {
  findNavItem,
  NAV_GROUPS,
  NAV_ITEM_ICONS,
  pageIdFromPath,
  SETTINGS_NAV_ITEM,
  type NavItem,
} from "@/lib/navigation";

export function Layout() {
  const location = useLocation();
  const { navigateToPage } = useAppNavigation();
  const page = pageIdFromPath(location.pathname) ?? "chat";
  const { error } = useAppContext();
  const prefetchAppData = usePrefetchAppData();
  const { collapsed, toggle } = useSidebarCollapsed();
  const activeNav = findNavItem(page);

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
              src="/tinyclaw.png"
              alt="TinyClaw"
              className="size-8 shrink-0 rounded-lg object-contain"
            />
            {!collapsed ? (
              <p className="type-brand min-w-0 flex-1 truncate">TinyClaw</p>
            ) : null}
            <SidebarCollapseButton collapsed={collapsed} onToggle={toggle} />
          </div>

          <nav
            className={cn(
              "no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto",
              collapsed ? "p-2" : "p-3",
            )}
          >
            {NAV_GROUPS.map((group, groupIndex) => (
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
                        onClick={() => navigateToPage(item.id)}
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
              collapsed ? "justify-center px-2 py-2.5" : "px-3 py-3",
            )}
          >
            <SidebarNavButton
              item={SETTINGS_NAV_ITEM}
              icon={NAV_ITEM_ICONS.settings}
              active={page === "settings"}
              collapsed={collapsed}
              onClick={() => navigateToPage("settings")}
              onPrefetch={prefetchAppData}
            />
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {page !== "chat" && page !== "status" ? (
            <header className="app-shell-header justify-between gap-4 bg-card px-6">
              <h1 className="type-brand min-w-0 truncate">{activeNav?.label}</h1>
              <ConnectionBar />
            </header>
          ) : null}

          {error ? (
            <div className="shrink-0 border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}

          <main
            className={
              page === "chat"
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
  onClick,
  onPrefetch,
  className,
}: {
  item: NavItem;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  onPrefetch?: () => void;
  className?: string;
}) {
  const button = (
    <button
      type="button"
      title={collapsed ? undefined : item.description}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      data-active={active || undefined}
      className={cn(
        "sidebar-nav-link",
        collapsed && "sidebar-nav-link--collapsed",
        className,
      )}
    >
      <Icon
        className="sidebar-nav-icon"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      {!collapsed ? (
        <span className="min-w-0 truncate">{item.label}</span>
      ) : null}
    </button>
  );

  if (!collapsed) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="right" sideOffset={8}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}
