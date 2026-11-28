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
 * `children` (the page's search) fills the row, `actions` sit after the tabs.
 */
export function IntegrationsTabs({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { activeOrg, user } = useAuth();
  const onConnectors = useMatch(PAGE_PATHS.composio) !== null;

  const showTabs = canAccessSystemPage(
    user?.isPlatformAdmin === true,
    activeOrg?.role
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 basis-64">{children}</div>
      {showTabs ? (
        <nav
          aria-label="Connections"
          className="flex rounded-lg bg-muted p-0.5"
        >
          {INTEGRATION_TABS.map((tab) => {
            const active = (tab.path === PAGE_PATHS.composio) === onConnectors;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  active
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={tab.path}
                to={tab.path}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
      {actions}
    </div>
  );
}
