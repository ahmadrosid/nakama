import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { ProfileRail } from "@/components/ProfileRail";
import { RouteBoundary } from "@/components/RouteBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveChatProfileProvider } from "@/context/active-chat-profile-context";
import { useAppContext } from "@/context/use-app-context";
import {
  findNavItem,
  PAGE_PATHS,
  type PageId,
  pageIdFromPath,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { AgentWorkTabs } from "@/pages/automations/agent-work-tabs";

export function Layout() {
  const shell = useAppShell();

  return (
    <TooltipProvider delay={0}>
      <ActiveChatProfileProvider>
        <div className="flex h-svh overflow-hidden bg-background pl-[env(safe-area-inset-left)]">
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
            <AppShellHeader label={shell.activeNav?.label} page={shell.page} />
            <AppShellError error={shell.error} />
            <main className={appShellMainClassName(shell.page, shell.pathname)}>
              <RouteBoundary resetKey={shell.pathname}>
                <Outlet />
              </RouteBoundary>
            </main>
          </div>
        </div>
        <CommandPalette />
      </ActiveChatProfileProvider>
    </TooltipProvider>
  );
}

function useAppShell() {
  const location = useLocation();
  const page = pageIdFromPath(location.pathname) ?? "chat";
  const { error } = useAppContext();

  return {
    activeNav: findNavItem(page),
    error,
    page,
    pathname: location.pathname,
  };
}

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
    flush
      ? "flex flex-col overflow-hidden"
      : "overflow-y-auto overflow-x-hidden",
    flush || skillDetail ? null : "p-4 sm:p-6"
  );
}

function AppShellHeader({
  label,
  page,
}: {
  label: string | undefined;
  page: PageId;
}) {
  const hideTitle = page === "soul" || page === "profiles";

  return (
    <header
      className={cn(
        "app-shell-header gap-2 bg-card px-3 sm:gap-4 sm:px-6",
        // Chat gives its whole column to the conversation on desktop; on a
        // phone the bar is the only way to reach navigation.
        page === "chat" && "sm:hidden"
      )}
    >
      <MobileNavDrawer className="sm:hidden" />
      {page === "automations" ? (
        <AgentWorkTabs />
      ) : hideTitle ? null : (
        <h1 className="type-brand min-w-0 truncate">{label}</h1>
      )}
      <div
        className={cn(
          "flex h-full min-w-0 shrink-0 items-stretch gap-2",
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
