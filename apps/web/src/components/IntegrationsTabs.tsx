import { cn } from "@nakama/ui/utils";
import type { ReactNode } from "react";
import { Link, useMatch } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { canAccessSystemPage, PAGE_PATHS } from "@/lib/navigation";

const INTEGRATION_TABS = [
  { label: "Connectors", path: PAGE_PATHS.composio },
  { label: "Plugins", path: PAGE_PATHS["plugin-management"] },
] as const;

/**
 * Connectors and Plugins share one sidebar item; this switches between them.
 * `children` (the page's search and actions) sits on the same row.
 */
export function IntegrationsTabs({ children }: { children: ReactNode }) {
  const { activeOrg, user } = useAuth();
  const onConnectors = useMatch(PAGE_PATHS.composio) !== null;

  if (!canAccessSystemPage(user?.isPlatformAdmin === true, activeOrg?.role)) {
    return <div className="flex items-center gap-3">{children}</div>;
  }

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-border border-b">
      <nav aria-label="Connections" className="flex gap-6">
        {INTEGRATION_TABS.map((tab) => {
          const active = (tab.path === PAGE_PATHS.composio) === onConnectors;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 py-3 text-sm",
                active
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              key={tab.path}
              to={tab.path}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="order-first flex w-full items-center gap-3 sm:order-none sm:ml-auto sm:w-auto sm:pb-2">
        {children}
      </div>
    </div>
  );
}
