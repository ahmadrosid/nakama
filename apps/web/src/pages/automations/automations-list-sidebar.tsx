import { SearchIcon } from "lucide-react";
import { RefreshCwIcon } from "lucide-react";
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
    <aside className="hidden min-h-0 min-w-0 flex-col border-b border-border lg:flex lg:border-r lg:border-b-0">
      <div className="shrink-0 space-y-3 border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {filteredAutomations.length} shown
            {filteredAutomations.length !== automations.length
              ? ` of ${automations.length}`
              : ""}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy || automationsRefreshing}
            aria-label="Refresh automations"
            onClick={() => void refresh()}
          >
            {automationsRefreshing ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCwIcon className="size-3.5" aria-hidden />
            )}
          </Button>
        </div>

        <AutomationSearch
          value={searchQuery}
          disabled={initialLoading || automations.length === 0 || busy}
          isSearching={isSearching}
          onChange={setSearchQuery}
          onClear={() => setSearchQuery("")}
        />
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
            <SearchIcon className="size-5 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm font-medium text-foreground">No matching automations</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a different search term.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-b border-border">
            {filteredAutomations.map((automation) => (
              <li key={automation.id}>
                <AutomationListItem
                  automation={automation}
                  selected={selectedId === automation.id}
                  unreadCount={unreadByAutomationId[automation.id] ?? 0}
                  busy={busy}
                  onSelect={() => setSelectedId(automation.id)}
                  onDelete={setDeleteTarget}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
