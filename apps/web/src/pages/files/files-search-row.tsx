import { Search01Icon } from "hugeicons-react";
import {
  ARTIFACT_TYPE_FILTER_LABELS,
  type ArtifactTypeFilter,
} from "@/components/soul-tools/artifacts-tab-filters";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function FilesSearchRow({
  searchQuery,
  onSearchQueryChange,
  typeOptions,
  typeFilter,
  onTypeFilterChange,
}: {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  typeOptions: ArtifactTypeFilter[];
  typeFilter: ArtifactTypeFilter;
  onTypeFilterChange: (value: ArtifactTypeFilter) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <Search01Icon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="h-8 border-border/60 bg-muted/20 pl-8 text-sm shadow-none focus-visible:border-foreground/20 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-foreground/10 dark:bg-muted/15 dark:focus-visible:bg-background/60"
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search files…"
          value={searchQuery}
        />
      </div>
      <Select
        onValueChange={(value) => {
          if (value != null) {
            onTypeFilterChange(value as ArtifactTypeFilter);
          }
        }}
        value={typeFilter}
      >
        <SelectTrigger
          aria-label="Filter by file type"
          className="h-8 w-full shrink-0 border-border/60 bg-muted/20 shadow-none sm:w-40 dark:bg-muted/15"
        >
          <SelectValue>{ARTIFACT_TYPE_FILTER_LABELS[typeFilter]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {typeOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {ARTIFACT_TYPE_FILTER_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
