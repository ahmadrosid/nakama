import { cn } from "@nakama/ui/utils";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { canOpenPage, PAGE_PATHS } from "@/lib/navigation";

const INTEGRATION_TABS = [
  { id: "composio", label: "Connectors" },
  { id: "plugin-management", label: "Plugins" },
  { id: "skills", label: "Skills" },
] as const;

/**
 * Connectors, Plugins and Skills share one sidebar item; this switches between
 * them. `children` (the page's search) fills the row, `actions` sit after the tabs.
 */
export function IntegrationsTabs({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { activeOrg, user } = useAuth();
  const { pathname } = useLocation();

  const access = {
    isPlatformAdmin: user?.isPlatformAdmin === true,
    orgRole: activeOrg?.role,
  };

  const tabs = INTEGRATION_TABS.filter((tab) => canOpenPage(tab.id, access));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 basis-64">{children}</div>
      {tabs.length > 1 ? (
        <nav
          aria-label="Connections"
          className="flex rounded-lg bg-muted p-0.5"
        >
          {tabs.map((tab) => {
            const path = PAGE_PATHS[tab.id];
            const active = pathname === path || pathname.startsWith(`${path}/`);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  active
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={tab.id}
                to={path}
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
