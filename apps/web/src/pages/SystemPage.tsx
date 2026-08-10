import { useCallback } from "react";
import { createPortal } from "react-dom";
import { Navigate, useSearchParams } from "react-router-dom";
import { McpTab } from "@/components/soul-tools/McpTab";
import { ToolsTab } from "@/components/soul-tools/ToolsTab";
import { OrganizationPanel } from "@/components/system/OrganizationPanel";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { canAccessSystemPage } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { StatusPage } from "@/pages/StatusPage";
import {
  resolveSystemTab,
  type SYSTEM_TABS,
  type SystemTabId,
  visibleSystemTabs,
} from "@/pages/system-page.shared";

export function SystemPage() {
  const { user, activeOrg, isLoading } = useAuth();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const canAccess = canAccessSystemPage(isPlatformAdmin, activeOrg?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolveSystemTab(searchParams.get("tab"), isPlatformAdmin);
  const visibleTabs = visibleSystemTabs(isPlatformAdmin);
  const pageHeaderActions =
    typeof document === "undefined"
      ? null
      : document.querySelector<HTMLElement>("[data-page-header-actions]");

  const setTab = useCallback(
    (nextTab: SystemTabId) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextTab === "tools") {
            next.delete("tab");
          } else {
            next.set("tab", nextTab);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground text-sm">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (!canAccess) {
    return <Navigate replace to="/chat" />;
  }

  return (
    <>
      {pageHeaderActions
        ? createPortal(
            <div
              aria-label="System"
              className="flex h-full min-w-0 items-stretch"
              role="tablist"
            >
              {visibleTabs.map((item) => (
                <SystemTabButton
                  active={tab === item.id}
                  controls={`system-panel-${item.id}`}
                  icon={item.icon}
                  id={`system-tab-${item.id}`}
                  key={item.id}
                  label={item.label}
                  onSelect={() => setTab(item.id)}
                />
              ))}
            </div>,
            pageHeaderActions
          )
        : null}
      <section className="overflow-hidden rounded-md border border-border bg-card">
        <div
          aria-labelledby={`system-tab-${tab}`}
          id={`system-panel-${tab}`}
          role="tabpanel"
        >
          {tab === "status" ? (
            <StatusPage embedded />
          ) : tab === "organization" ? (
            <OrganizationPanel />
          ) : tab === "tools" ? (
            <ToolsTab embedded />
          ) : (
            <McpTab embedded />
          )}
        </div>
      </section>
    </>
  );
}

function SystemTabButton({
  id,
  label,
  icon: Icon,
  active,
  controls,
  onSelect,
}: {
  id: string;
  label: string;
  icon: (typeof SYSTEM_TABS)[number]["icon"];
  active: boolean;
  controls: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-controls={controls}
      aria-selected={active}
      className={cn(
        "relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 font-medium text-sm transition-colors sm:px-4",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
      data-active={active || undefined}
      id={id}
      onClick={onSelect}
      role="tab"
      type="button"
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </button>
  );
}
