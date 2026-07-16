import type { LucideIcon } from "lucide-react";
import { useCallback } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { McpTab } from "@/components/soul-tools/McpTab";
import { ToolsTab } from "@/components/soul-tools/ToolsTab";
import { DataPortabilityPanel } from "@/components/system/DataPortabilityPanel";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { canAccessSystemPage } from "@/lib/navigation";
import { resolveSystemTab, visibleSystemTabs, type SystemTabId } from "@/pages/system-page.shared";
import { cn } from "@/lib/utils";

export function SystemPage() {
  const { user, activeOrg, isLoading } = useAuth();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const canAccess = canAccessSystemPage(isPlatformAdmin, activeOrg?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolveSystemTab(searchParams.get("tab"), isPlatformAdmin);
  const visibleTabs = visibleSystemTabs(isPlatformAdmin);

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
        { replace: true },
      );
    },
    [setSearchParams],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (!canAccess) {
    return <Navigate to="/chat" replace />;
  }

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div
        role="tablist"
        aria-label="System tools"
        className="flex shrink-0 border-b border-border px-4 sm:px-5"
      >
        {visibleTabs.map((item) => (
          <SystemTabButton
            key={item.id}
            id={`system-tab-${item.id}`}
            label={item.label}
            icon={item.icon}
            active={tab === item.id}
            controls={`system-panel-${item.id}`}
            onSelect={() => setTab(item.id)}
          />
        ))}
      </div>

      <div
        id={`system-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`system-tab-${tab}`}
      >
        {tab === "tools" ? (
          <ToolsTab embedded />
        ) : tab === "mcp" ? (
          <McpTab embedded />
        ) : (
          <DataPortabilityPanel />
        )}
      </div>
    </section>
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
  icon: LucideIcon;
  active: boolean;
  controls: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      data-active={active || undefined}
      className={cn(
        "relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      onClick={onSelect}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}
