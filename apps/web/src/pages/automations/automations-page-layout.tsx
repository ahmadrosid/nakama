import { Button } from "@nakama/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { Message01Icon } from "hugeicons-react";
import { AutomationDetailPanel } from "@/pages/automations/automation-detail-panel";
import {
  AutomationDetailSkeleton,
  AutomationPanelPlaceholder,
  AutomationSearch,
  AutomationsEmptyState,
} from "@/pages/automations/automations-components";
import { AutomationsListSidebar } from "@/pages/automations/automations-list-sidebar";
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
    loading,
    refreshing,
    initialLoading,
    selected,
    filteredAutomations,
    error,
    goToCreateAutomation,
  } = state;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? (
        <p
          className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-col gap-3 border-border border-b p-4 lg:hidden">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              disabled={busy || refreshing || automations.length === 0}
              onValueChange={(value) => {
                if (value) {
                  setSelectedId(String(value));
                }
              }}
              value={selectedId}
            >
              <SelectTrigger
                aria-label="Selected automation"
                className="min-w-0 flex-1"
              >
                <SelectValue placeholder="Select automation">
                  {
                    automations.find(
                      (automation) => automation.id === selectedId
                    )?.name
                  }
                </SelectValue>
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

            <Button onClick={goToCreateAutomation} size="sm" type="button">
              <Message01Icon aria-hidden className="size-4" />
              Create automation
            </Button>
          </div>

          <AutomationSearch
            disabled={initialLoading || automations.length === 0 || busy}
            onChange={setSearchQuery}
            onClear={() => setSearchQuery("")}
            value={searchQuery}
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
                <Button onClick={goToCreateAutomation} size="sm" type="button">
                  Create automation
                </Button>
              </AutomationPanelPlaceholder>
            ) : selected ? (
              <AutomationDetailPanel {...state} />
            ) : (
              <AutomationPanelPlaceholder>
                Select an automation to view runs.
              </AutomationPanelPlaceholder>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
