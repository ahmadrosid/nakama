import { ArrowDown01Icon } from "hugeicons-react";
import { useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useTimezoneCatalog } from "@/hooks/use-timezones";
import {
  getBrowserTimezone,
  getFilteredTimezoneGroups,
  getTimezoneDisplay,
} from "@/lib/timezones";
import { cn } from "@/lib/utils";

interface TimezoneSelectProps {
  allowAccountDefault?: boolean;
  className?: string;
  disabled?: boolean;
  emptyLabel?: string;
  id?: string;
  onValueChange: (value: string | undefined) => void;
  placeholder?: string;
  showBrowserQuickPick?: boolean;
  value: string | undefined;
}

export function TimezoneSelect({
  id,
  value,
  onValueChange,
  disabled = false,
  placeholder = "Search timezones…",
  emptyLabel = "Select timezone",
  allowAccountDefault = false,
  showBrowserQuickPick = true,
  className,
}: TimezoneSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: catalog, isLoading, isError } = useTimezoneCatalog();
  const browserTimezone = useMemo(() => getBrowserTimezone(), []);

  const filteredGroups = useMemo(
    () => getFilteredTimezoneGroups(query, catalog),
    [catalog, query]
  );

  const selectedLabel =
    allowAccountDefault && !value?.trim()
      ? "Account default"
      : getTimezoneDisplay(value, emptyLabel, catalog);

  const showSuggested = allowAccountDefault || showBrowserQuickPick;
  const loading = isLoading;
  const unavailable = isError || !(loading || catalog);

  function closeWithValue(nextValue: string | undefined) {
    onValueChange(nextValue);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="w-full">
      <Popover
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);

          if (!nextOpen) {
            setQuery("");
          }
        }}
        open={open}
      >
        <TimezoneSelectTrigger
          allowAccountDefault={allowAccountDefault}
          className={className}
          disabled={disabled}
          id={id}
          loading={loading}
          selectedLabel={selectedLabel}
          unavailable={unavailable}
          value={value}
        />

        <PopoverContent
          align="start"
          className="overflow-hidden p-0"
          sideOffset={4}
        >
          <Command
            className="rounded-lg bg-transparent p-0"
            shouldFilter={false}
          >
            <div className="border-border/60 border-b p-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput
                disabled={loading || unavailable}
                onValueChange={setQuery}
                placeholder={placeholder}
                value={query}
              />
            </div>
            <CommandList className="max-h-72 p-1">
              <TimezoneSelectOptions
                allowAccountDefault={allowAccountDefault}
                browserTimezone={browserTimezone}
                catalog={catalog}
                filteredGroups={filteredGroups}
                loading={loading}
                onSelectValue={closeWithValue}
                query={query}
                showBrowserQuickPick={showBrowserQuickPick}
                showSuggested={showSuggested}
                unavailable={unavailable}
              />
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function timezoneTriggerLabel(input: {
  loading: boolean;
  selectedLabel: string;
  unavailable: boolean;
}): string {
  if (input.loading) {
    return "Loading timezones…";
  }

  if (input.unavailable) {
    return "Timezone list unavailable";
  }

  return input.selectedLabel;
}

function TimezoneSelectTrigger({
  allowAccountDefault,
  className,
  disabled,
  id,
  loading,
  selectedLabel,
  unavailable,
  value,
}: {
  allowAccountDefault: boolean;
  className?: string;
  disabled: boolean;
  id?: string;
  loading: boolean;
  selectedLabel: string;
  unavailable: boolean;
  value: string | undefined;
}) {
  return (
    <PopoverTrigger
      aria-label="Select timezone"
      className={cn(
        "flex h-8 w-full cursor-pointer select-none items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
        !value?.trim() && allowAccountDefault && "text-muted-foreground",
        className
      )}
      disabled={disabled || loading}
      id={id}
    >
      <span className="min-w-0 flex-1 truncate text-left">
        {timezoneTriggerLabel({ loading, selectedLabel, unavailable })}
      </span>
      {loading ? (
        <Spinner className="size-4 shrink-0" />
      ) : (
        <ArrowDown01Icon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      )}
    </PopoverTrigger>
  );
}

function TimezoneSuggestedGroup({
  allowAccountDefault,
  browserTimezone,
  catalog,
  onSelectValue,
  showBrowserQuickPick,
}: {
  allowAccountDefault: boolean;
  browserTimezone: string;
  catalog: ReturnType<typeof useTimezoneCatalog>["data"];
  onSelectValue: (value: string | undefined) => void;
  showBrowserQuickPick: boolean;
}) {
  return (
    <CommandGroup className="p-1" heading="Suggested">
      {allowAccountDefault ? (
        <CommandItem
          onSelect={() => onSelectValue(undefined)}
          value="__account_default__"
        >
          Account default
        </CommandItem>
      ) : null}
      {showBrowserQuickPick ? (
        <CommandItem
          onSelect={() => onSelectValue(browserTimezone)}
          value={browserTimezone}
        >
          Browser ·{" "}
          {getTimezoneDisplay(browserTimezone, browserTimezone, catalog)}
        </CommandItem>
      ) : null}
    </CommandGroup>
  );
}

function TimezoneSelectOptions({
  allowAccountDefault,
  browserTimezone,
  catalog,
  filteredGroups,
  loading,
  onSelectValue,
  query,
  showBrowserQuickPick,
  showSuggested,
  unavailable,
}: {
  allowAccountDefault: boolean;
  browserTimezone: string;
  catalog: ReturnType<typeof useTimezoneCatalog>["data"];
  filteredGroups: ReturnType<typeof getFilteredTimezoneGroups>;
  loading: boolean;
  onSelectValue: (value: string | undefined) => void;
  query: string;
  showBrowserQuickPick: boolean;
  showSuggested: boolean;
  unavailable: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
        <Spinner />
        Loading…
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        Could not load timezones.
      </div>
    );
  }

  return (
    <>
      <CommandEmpty className="py-6">No timezone found.</CommandEmpty>

      {showSuggested && !query.trim() ? (
        <TimezoneSuggestedGroup
          allowAccountDefault={allowAccountDefault}
          browserTimezone={browserTimezone}
          catalog={catalog}
          onSelectValue={onSelectValue}
          showBrowserQuickPick={showBrowserQuickPick}
        />
      ) : null}

      {filteredGroups.map((group) => (
        <CommandGroup
          className="p-1"
          heading={group.countryName}
          key={group.countryCode}
        >
          {group.timezones.map((option) => (
            <CommandItem
              key={option.id}
              onSelect={() => onSelectValue(option.id)}
              value={option.id}
            >
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="min-w-0 truncate">{option.label}</span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {option.abbreviation}
                </span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </>
  );
}
