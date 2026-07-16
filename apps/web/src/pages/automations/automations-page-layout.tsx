import { MessageSquareIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { AutomationDetailPanel } from "@/pages/automations/automation-detail-panel";
import {
  AutomationDetailSkeleton,
  AutomationPanelPlaceholder,
  AutomationSearch,
  AutomationsEmptyState,
} from "@/pages/automations/automations-components";
import { AutomationsListSidebar } from "@/pages/automations/automations-list-sidebar";
import { sectionClass } from "@/pages/automations/automations-page.shared";
import type { AutomationsPageState } from "@/pages/automations/use-automations-page";

export function AutomationsPageLayout(state: AutomationsPageState) {
  const {
    automations,
    unreadByAutomationId,
    selectedId,
    setSelectedId,
    busy,
    searchQuery,
    setSearchQuery,
    isSearching,
    loading,
    refreshing,
    initialLoading,
    selected,
    filteredAutomations,
    error,
    goToCreateAutomation,
    refresh,
  } = state;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      {error ? (
        <p
          className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section
        className={cn(sectionClass, "flex min-h-0 flex-1 flex-col overflow-hidden")}
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-border p-4 lg:hidden">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={selectedId ?? undefined}
              disabled={busy || refreshing || automations.length === 0}
              onValueChange={(value) => {
                if (value) {
                  setSelectedId(String(value));
                }
              }}
            >
              <SelectTrigger className="min-w-0 flex-1" aria-label="Selected automation">
                <SelectValue placeholder="Select automation" />
              </SelectTrigger>
              <SelectContent>
                {filteredAutomations.map((automation) => (
                  <SelectItem key={automation.id} value={automation.id}>
                    {automation.name}
                    {(unreadByAutomationId[automation.id] ?? 0) > 0
                      ? ` (${unreadByAutomationId[automation.id]})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy || refreshing}
                aria-label="Refresh automations"
                onClick={() => void refresh()}
              >
                {refreshing ? (
                  <Spinner className="size-4" />
                ) : (
                  <RefreshCwIcon className="size-4" aria-hidden />
                )}
              </Button>
              <Button type="button" size="sm" onClick={goToCreateAutomation}>
                <MessageSquareIcon className="size-4" aria-hidden />
                Create automation
              </Button>
            </div>
          </div>

          <AutomationSearch
            value={searchQuery}
            disabled={initialLoading || automations.length === 0 || busy}
            isSearching={isSearching}
            onChange={setSearchQuery}
            onClear={() => setSearchQuery("")}
          />
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
          <AutomationsListSidebar {...state} />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-5">
            {loading ? (
              <AutomationDetailSkeleton />
            ) : automations.length === 0 ? (
              <AutomationPanelPlaceholder>
                <AutomationsEmptyState />
                <Button type="button" size="sm" onClick={goToCreateAutomation}>
                  Create automation
                </Button>
              </AutomationPanelPlaceholder>
            ) : !selected ? (
              <AutomationPanelPlaceholder>
                Select an automation to view runs.
              </AutomationPanelPlaceholder>
            ) : (
              <AutomationDetailPanel {...state} />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
