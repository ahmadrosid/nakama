import { GridViewIcon, ListViewIcon, Refresh01Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FilesViewMode } from "@/lib/files-page.shared";

function FilesViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: FilesViewMode;
  onChange: (mode: FilesViewMode) => void;
}) {
  return (
    <div
      aria-label="View mode"
      className="flex shrink-0 items-center rounded-md border border-border/60 p-0.5"
      role="group"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              onClick={() => onChange("list")}
              size="icon-sm"
              type="button"
              variant={viewMode === "list" ? "secondary" : "ghost"}
            >
              <ListViewIcon aria-hidden className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent side="bottom" sideOffset={6}>
          List
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
              onClick={() => onChange("grid")}
              size="icon-sm"
              type="button"
              variant={viewMode === "grid" ? "secondary" : "ghost"}
            >
              <GridViewIcon aria-hidden className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent side="bottom" sideOffset={6}>
          Grid
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function FilesToolbar({
  showViewModeToggle,
  viewMode,
  onViewModeChange,
  isFetching,
  onRefresh,
}: {
  showViewModeToggle: boolean;
  viewMode: FilesViewMode;
  onViewModeChange: (mode: FilesViewMode) => void;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="type-section-title text-balance">Artifacts</h2>
      <div className="flex shrink-0 items-center gap-2">
        {showViewModeToggle ? (
          <FilesViewModeToggle
            onChange={onViewModeChange}
            viewMode={viewMode}
          />
        ) : null}
        <Button onClick={onRefresh} size="sm" type="button" variant="outline">
          {isFetching ? (
            <Spinner className="size-4" />
          ) : (
            <Refresh01Icon aria-hidden className="size-4" />
          )}
          Refresh
        </Button>
      </div>
    </div>
  );
}
