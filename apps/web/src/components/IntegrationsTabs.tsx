import { Button } from "@nakama/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nakama/ui/dropdown-menu";
import { cn } from "@nakama/ui/utils";
import { Add01Icon, ArrowDown01Icon } from "hugeicons-react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import {
  canManagePluginReleases,
  canOpenPage,
  PAGE_PATHS,
} from "@/lib/navigation";

const INTEGRATION_TABS = [
  { id: "composio", label: "Connectors" },
  { id: "plugin-management", label: "Plugins" },
  { id: "skills", label: "Skills" },
] as const;

/** The Plugins page opens the matching install dialog when it sees this param. */
export const PLUGIN_ADD_PARAM = "add";

/**
 * Connectors, Plugins and Skills share one sidebar item; this switches between
 * them. `children` (the page's search) fills the row. The Add menu sits after
 * the tabs on each of them.
 */
export function IntegrationsTabs({ children }: { children: ReactNode }) {
  const { activeOrg, user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const access = {
    isPlatformAdmin: user?.isPlatformAdmin === true,
    orgRole: activeOrg?.role,
  };

  const canAddPlugin =
    canManagePluginReleases(access.isPlatformAdmin) && Boolean(activeOrg);

  const addPlugin = (source: "folder" | "npm") =>
    navigate(
      `${PAGE_PATHS["plugin-management"]}?${PLUGIN_ADD_PARAM}=${source}`
    );

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
      {canAddPlugin ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button />}>
            <Add01Icon aria-hidden="true" className="size-4" />
            Add
            <ArrowDown01Icon aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => addPlugin("folder")}>
              Plugin made by an agent
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addPlugin("npm")}>
              Plugin from npm package
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
