import { RefreshIcon, Search01Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  AutomationListItem,
  AutomationListSkeleton,
  AutomationSearch,
  AutomationsEmptyState,
} from "@/pages/automations/automations-components";
import type { AutomationsPageState } from "@/pages/automations/use-automations-page";

type ListState = Pick<
  AutomationsPageState,
  | "automations"
  | "unreadByAutomationId"
  | "selectedId"
  | "setSelectedId"
  | "busy"
  | "searchQuery"
  | "setSearchQuery"
  | "isSearching"
  | "initialLoading"
  | "automationsRefreshing"
  | "filteredAutomations"
  | "setDeleteTarget"
  | "refresh"
>;

export function AutomationsListSidebar(state: ListState) {
  const {
    automations,
    unreadByAutomationId,
    selectedId,
    setSelectedId,
    busy,
    searchQuery,
    setSearchQuery,
    isSearching,
    initialLoading,
    automationsRefreshing,
    filteredAutomations,
    setDeleteTarget,
    refresh,
  } = state;

  return (
    <aside className="hidden min-h-0 min-w-0 flex-col border-border border-b lg:flex lg:border-r lg:border-b-0">
      <div className="shrink-0 space-y-3 border-border border-b px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <AutomationSearch
              disabled={initialLoading || automations.length === 0 || busy}
              isSearching={isSearching}
              onChange={setSearchQuery}
              onClear={() => setSearchQuery("")}
              value={searchQuery}
            />
          </div>
          <Button
            aria-label="Refresh automations"
            disabled={busy || automationsRefreshing}
            onClick={() => void refresh()}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {automationsRefreshing ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshIcon aria-hidden className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {initialLoading ? (
          <AutomationListSkeleton />
        ) : automations.length === 0 ? (
          <div className="flex min-h-[12rem] items-center justify-center">
            <AutomationsEmptyState />
          </div>
        ) : filteredAutomations.length === 0 ? (
          <div className="flex min-h-[12rem] flex-col items-center justify-center px-2 py-10 text-center">
            <Search01Icon
              aria-hidden
              className="size-5 text-muted-foreground"
            />
            <p className="mt-3 font-medium text-foreground text-sm">
              No matching automations
            </p>
            <p className="mt-1 text-muted-foreground text-sm">
              Try a different search term.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-border border-b">
            {filteredAutomations.map((automation) => (
              <li key={automation.id}>
                <AutomationListItem
                  automation={automation}
                  busy={busy}
                  onDelete={setDeleteTarget}
                  onSelect={() => setSelectedId(automation.id)}
                  selected={selectedId === automation.id}
                  unreadCount={unreadByAutomationId[automation.id] ?? 0}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
