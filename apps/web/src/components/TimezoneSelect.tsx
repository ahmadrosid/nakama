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

function TimezoneCommandListBody({
  loading,
  unavailable,
  showSuggested,
  query,
  allowAccountDefault,
  showBrowserQuickPick,
  browserTimezone,
  catalog,
  filteredGroups,
  onPick,
}: {
  loading: boolean;
  unavailable: boolean;
  showSuggested: boolean;
  query: string;
  allowAccountDefault: boolean;
  showBrowserQuickPick: boolean;
  browserTimezone: string;
  catalog: ReturnType<typeof useTimezoneCatalog>["data"];
  filteredGroups: ReturnType<typeof getFilteredTimezoneGroups>;
  onPick: (value: string | undefined) => void;
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
        <CommandGroup className="p-1" heading="Suggested">
          {allowAccountDefault ? (
            <CommandItem
              onSelect={() => onPick(undefined)}
              value="__account_default__"
            >
              Account default
            </CommandItem>
          ) : null}
          {showBrowserQuickPick ? (
            <CommandItem
              onSelect={() => onPick(browserTimezone)}
              value={browserTimezone}
            >
              Browser ·{" "}
              {getTimezoneDisplay(browserTimezone, browserTimezone, catalog)}
            </CommandItem>
          ) : null}
        </CommandGroup>
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
              onSelect={() => onPick(option.id)}
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

  function pickTimezone(next: string | undefined) {
    onValueChange(next);
    setOpen(false);
    setQuery("");
  }

  const triggerLabel = loading
    ? "Loading timezones…"
    : unavailable
      ? "Timezone list unavailable"
      : selectedLabel;

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
            {triggerLabel}
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
              <TimezoneCommandListBody
                allowAccountDefault={allowAccountDefault}
                browserTimezone={browserTimezone}
                catalog={catalog}
                filteredGroups={filteredGroups}
                loading={loading}
                onPick={pickTimezone}
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
