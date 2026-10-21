import { Button } from "@nakama/ui/button";
import { TooltipProvider } from "@nakama/ui/tooltip";
import { cn } from "@nakama/ui/utils";
import {
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Search01Icon,
} from "hugeicons-react";
import { lazy, Suspense, useMemo } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useMatch,
  useNavigate,
} from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { ProfileRail } from "@/components/ProfileRail";
import { RouteBoundary } from "@/components/RouteBoundary";
import { useBtwChatStore } from "@/context/btw-chat-store";
import { useAppContext } from "@/context/use-app-context";
import { useAgentGroupQuery } from "@/hooks/use-agent-groups";
import { useOrgPlugins } from "@/hooks/use-plugins";
import {
  useHistorySessionsQuery,
  useSessionSummaryQuery,
} from "@/hooks/use-resource-mutations";
import {
  enabledPluginNavEntries,
  findNavItem,
  groupRouteFromPath,
  PAGE_PATHS,
  type PageId,
  pageIdFromPath,
  pluginIdFromPath,
  SIDEBAR_PAGE_IDS,
  sidebarPageId,
} from "@/lib/navigation";

const BtwChatHost = lazy(() =>
  import("@/components/chat/btw-chat").then((module) => ({
    default: module.BtwChatHost,
  }))
);

export function Layout() {
  const shell = useAppShell();
  const btwOpen = useBtwChatStore((store) => store.chat !== null);

  return (
    <TooltipProvider delay={0}>
      <div className="flex h-svh flex-col overflow-hidden bg-background">
        <DesktopTitleBar />
        <div className="flex min-h-0 flex-1 overflow-hidden pl-[env(safe-area-inset-left)]">
          {/* The rail and sidebar cost a fixed 296px, so on a phone they live
            in MobileNavDrawer instead of the layout. */}
          <div className="hidden h-full sm:flex">
            <ProfileRail />
            <AppSidebar />
          </div>
          <div
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-[env(safe-area-inset-right)]"
            data-app-shell-content=""
          >
            <AppShellHeader
              hideDesktop={
                shell.pathname === PAGE_PATHS.profiles ||
                shell.pathname.startsWith(`${PAGE_PATHS.profiles}/skills/`) ||
                // A group chat takes the full desktop column, like agent chat.
                groupRouteFromPath(shell.pathname) !== null
              }
              label={shell.headerLabel}
              page={shell.page}
            />
            <AppShellError error={shell.error} />
            <main className={appShellMainClassName(shell.page, shell.pathname)}>
              <RouteBoundary resetKey={shell.pathname}>
                <Outlet />
              </RouteBoundary>
            </main>
          </div>
        </div>
      </div>
      <CommandPalette />
      {btwOpen ? (
        <Suspense fallback={null}>
          <BtwChatHost />
        </Suspense>
      ) : null}
    </TooltipProvider>
  );
}

/**
 * The desktop app's window title bar. CSS shows it only under
 * `html[data-desktop]`, which the Electron preload sets.
 */
function DesktopTitleBar() {
  const navigate = useNavigate();
  const shortcut = navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl K";

  return (
    <div className="desktop-title-bar">
      <Button
        aria-label="Back"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => navigate(-1)}
        size="icon-sm"
        title="Back"
        variant="ghost"
      >
        <ArrowLeft01Icon aria-hidden="true" className="size-4" />
      </Button>
      <Button
        aria-label="Forward"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => navigate(1)}
        size="icon-sm"
        title="Forward"
        variant="ghost"
      >
        <ArrowRight01Icon aria-hidden="true" className="size-4" />
      </Button>
      <button
        className="desktop-title-bar-search"
        // CommandPalette owns its open state and listens for this shortcut.
        onClick={() =>
          window.dispatchEvent(
            new KeyboardEvent("keydown", { ctrlKey: true, key: "k" })
          )
        }
        type="button"
      >
        <Search01Icon aria-hidden="true" className="size-3.5" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="font-sans text-2xs">{shortcut}</kbd>
      </button>
    </div>
  );
}

function useAppShell() {
  const location = useLocation();
  const page = pageIdFromPath(location.pathname) ?? "chat";
  const { error } = useAppContext();
  const chatRoute = useMatch("/chat/:profileId/:sessionId");
  const chatProfileId = chatRoute?.params.profileId ?? "";
  const chatSessionId = chatRoute?.params.sessionId ?? null;

  const { data: sessions, hasNextPage } =
    useHistorySessionsQuery(chatProfileId);

  const listedChat = sessions.find((session) => session.id === chatSessionId);

  // An old chat opened by URL can sit on a page the sidebar has not loaded.
  const { data: unlistedChat } = useSessionSummaryQuery(
    chatProfileId,
    listedChat || !hasNextPage ? null : chatSessionId
  );

  const chatTitle = (listedChat ?? unlistedChat)?.title?.trim();

  // On a phone the header names the group.
  const groupRoute = groupRouteFromPath(location.pathname);
  const { data: group } = useAgentGroupQuery(groupRoute?.groupId ?? "");
  const groupTitle = group?.name;

  const { data: orgPlugins = [] } = useOrgPlugins();

  const pluginNav = useMemo(
    () => enabledPluginNavEntries(orgPlugins),
    [orgPlugins]
  );

  const activePluginId = pluginIdFromPath(location.pathname);

  const activePlugin = pluginNav.find(
    (entry) => entry.pluginId === activePluginId
  );

  return {
    error,
    headerLabel:
      chatTitle ||
      groupTitle ||
      (activePlugin?.label ??
        findNavItem(sidebarPageId(page))?.label ??
        activePluginId ??
        undefined),
    page,
    pathname: location.pathname,
  };
}

function isFlushContentPage(page: PageId, pathname: string): boolean {
  return (
    page === "chat" ||
    page === "automations" ||
    page === "files" ||
    page === "plugins" ||
    pathname.startsWith(`${PAGE_PATHS.groups}/`) ||
    pathname.startsWith(`${PAGE_PATHS.profiles}/skills/`) ||
    pathname.startsWith(`${PAGE_PATHS.soul}/playground/`)
  );
}

function appShellMainClassName(page: PageId, pathname: string): string {
  const flush = isFlushContentPage(page, pathname);
  const skillDetail = pathname.startsWith(`${PAGE_PATHS.profiles}/skills/`);

  return cn(
    "min-h-0 flex-1",
    flush
      ? "flex flex-col overflow-hidden"
      : "overflow-y-auto overflow-x-hidden",
    flush || skillDetail ? null : "p-4 sm:p-6"
  );
}

function AppShellHeader({
  hideDesktop,
  label,
  page,
}: {
  hideDesktop: boolean;
  label: string | undefined;
  page: PageId;
}) {
  const hideTitle = page === "soul";

  const showCustomizeBack =
    page !== "notifications" && !SIDEBAR_PAGE_IDS.includes(sidebarPageId(page));

  // SAFETY: PageId is a string union; the lookup falls back when the key is absent.
  const backLabel =
    {
      customize: "Back to Chat",
      plugins: "Back to Plugins",
    }[page as string] ?? "Back to Control center";

  // SAFETY: PageId is a string union; the lookup falls back when the key is absent.
  const backPath =
    {
      customize: PAGE_PATHS.chat,
      plugins: PAGE_PATHS["plugin-management"],
    }[page as string] ?? PAGE_PATHS.customize;

  return (
    <header
      className={cn(
        "app-shell-header gap-2 bg-card px-3 sm:gap-4 sm:px-6",
        // Standalone on iOS the shell owns the status bar, so the bar grows by
        // the top inset and paints its own background under the notch.
        "h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]",
        // Chat uses the full desktop column; phones still need the header
        // to reach navigation.
        (page === "chat" || hideDesktop) && "sm:hidden"
      )}
    >
      <MobileNavDrawer className="sm:hidden" />
      {(showCustomizeBack || page === "customize") && (
        <Button
          aria-label={backLabel}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          nativeButton={false}
          render={<Link to={backPath} />}
          size="icon-sm"
          title={backLabel}
          variant="ghost"
        >
          <ArrowLeft02Icon
            aria-hidden="true"
            className="size-4"
            strokeWidth={1.75}
          />
        </Button>
      )}
      {hideTitle ? null : (
        <h1 className="min-w-0 truncate font-normal text-base text-foreground tracking-tight">
          {label}
        </h1>
      )}
      <div
        className={cn(
          // Below sm the actions share the row with the menu button, so they
          // give way and scroll instead of pushing the header wider.
          "flex h-full min-w-0 items-stretch gap-2 sm:shrink-0",
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
    <div className="shrink-0 border-red-200 border-b bg-red-50 px-4 py-3 text-red-800 text-sm sm:px-6 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
      {error}
    </div>
  );
}
