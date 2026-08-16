import { ArrowLeft01Icon, ArrowRight01Icon } from "hugeicons-react";
import type { ElementType } from "react";
import { useMemo } from "react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { CommandPalette } from "@/components/CommandPalette";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { ProfileRail } from "@/components/ProfileRail";
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
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { chatProfileIdFromPath } from "@/lib/chat-history";
import {
  findNavItem,
  type NavItem,
  navHrefForPage,
  PAGE_PATHS,
  pageIdFromPath,
  visibleNavGroups,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { AgentWorkTabs } from "@/pages/automations/agent-work-tabs";
import { ProfileDetailTabButton } from "@/pages/profiles/profiles-ui";

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
  const navGroups = useMemo(
    () =>
      visibleNavGroups({
        isPlatformAdmin: user?.isPlatformAdmin === true,
        orgRole: activeOrg?.role,
      }),
    [activeOrg?.role, user?.isPlatformAdmin]
  );

  return (
    <TooltipProvider delay={0}>
      <ActiveChatProfileProvider>
        <div className="flex h-svh overflow-hidden bg-background max-sm:hidden">
          <ProfileRail />

          <aside
            aria-label="Main navigation"
            className="sidebar-shell flex h-full shrink-0 flex-col overflow-hidden border-border/50 border-r"
            data-collapsed={collapsed || undefined}
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
                  aria-label={group.label}
                  className="sidebar-nav-group"
                  key={group.id}
                  role="group"
                >
                  <div className="sidebar-nav-group-items">
                    {group.items.map((item) => (
                      <SidebarNavButton
                        active={item.id === page}
                        badge={
                          item.id === "automations"
                            ? automationUnreadTotal
                            : undefined
                        }
                        collapsed={collapsed}
                        icon={item.icon}
                        item={item}
                        key={item.id}
                        onPrefetch={
                          item.id === "automations"
                            ? prefetchAppData
                            : undefined
                        }
                        to={
                          item.id === "soul"
                            ? `${navHrefForPage(item.id, chatProfileId)}?tab=tools`
                            : navHrefForPage(item.id, chatProfileId)
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {page === "chat" ? null : (
              <header className="app-shell-header gap-4 bg-card px-6">
                {page === "automations" ? (
                  <AgentWorkTabs />
                ) : page === "files" ? (
                  <FilesViewTabs />
                ) : page === "soul" || page === "profiles" ? null : (
                  <h1 className="type-brand min-w-0 truncate">
                    {activeNav?.label}
                  </h1>
                )}
                <div
                  className={cn(
                    "flex h-full shrink-0 items-stretch gap-2",
                    page !== "soul" && page !== "profiles" && "ml-auto"
                  )}
                  data-page-header-actions
                />
              </header>
            )}

            {error ? (
              <div className="shrink-0 border-red-200 border-b bg-red-50 px-6 py-3 text-red-800 text-sm dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            ) : null}

            <main
              className={cn(
                "min-h-0 flex-1",
                page === "chat" ||
                  page === "tasks" ||
                  page === "automations" ||
                  page === "files" ||
                  location.pathname.startsWith(`${PAGE_PATHS.soul}/playground/`)
                  ? "flex flex-col overflow-hidden"
                  : "overflow-y-auto",
                !location.pathname.startsWith(
                  `${PAGE_PATHS.profiles}/skills/`
                ) &&
                  page !== "chat" &&
                  page !== "tasks" &&
                  page !== "automations" &&
                  page !== "files" &&
                  !location.pathname.startsWith(
                    `${PAGE_PATHS.soul}/playground/`
                  )
                  ? "p-6"
                  : null
              )}
            >
              <Outlet />
            </main>
          </div>
        </div>

        <NarrowViewportNotice />
        <CommandPalette />
      </ActiveChatProfileProvider>
    </TooltipProvider>
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

function FilesViewTabs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view =
    searchParams.get("tab") === "knowledge" ? "knowledge" : "artifacts";

  function selectView(nextView: "artifacts" | "knowledge") {
    if (nextView === "artifacts") {
      searchParams.delete("tab");
    } else {
      searchParams.set("tab", nextView);
    }
    setSearchParams(searchParams);
  }

  return (
    <div
      aria-label="Files views"
      className="flex h-full min-w-0 items-stretch"
      role="tablist"
    >
      <ProfileDetailTabButton
        active={view === "artifacts"}
        controls="files-page-panel-artifacts"
        id="files-page-tab-artifacts"
        onSelect={() => selectView("artifacts")}
      >
        Artifacts
      </ProfileDetailTabButton>
      <ProfileDetailTabButton
        active={view === "knowledge"}
        controls="files-page-panel-knowledge"
        id="files-page-tab-knowledge"
        onSelect={() => selectView("knowledge")}
      >
        Knowledge base
      </ProfileDetailTabButton>
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
