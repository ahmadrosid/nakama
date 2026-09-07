import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { CommandPalette } from "@/components/CommandPalette";
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
        <div className="flex h-svh overflow-hidden bg-background max-sm:hidden">
          <ProfileRail />
          <AppSidebar />
          <div
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
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
    flush ? "flex flex-col overflow-hidden" : "overflow-y-auto",
    flush || skillDetail ? null : "p-6"
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
