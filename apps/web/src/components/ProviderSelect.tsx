import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  isProviderTypeAlreadyConfigured,
  PROVIDER_OPTIONS,
  type SelectedProvider,
} from "@/lib/models";
import { cn } from "@/lib/utils";

export type ProviderSelectValue = SelectedProvider | "__browse__";

interface ProviderSelectProps {
  id?: string;
  value: ProviderSelectValue;
  onValueChange: (value: ProviderSelectValue) => void;
  disabled?: boolean;
  configuredTypes?: ReadonlySet<string>;
  className?: string;
}

const BROWSE_OPTION = {
  id: "__browse__" as const,
  label: "Browse free models…",
};

export function ProviderSelect({
  id,
  value,
  onValueChange,
  disabled = false,
  configuredTypes,
  className,
}: ProviderSelectProps) {
  const [open, setOpen] = useState(false);
  const configured = configuredTypes ?? EMPTY_CONFIGURED_TYPES;

  const selectedLabel = useMemo(() => {
    if (value === "__browse__") {
      return BROWSE_OPTION.label;
    }

    return PROVIDER_OPTIONS.find((option) => option.id === value)?.label ?? value;
  }, [value]);

  const sortedOptions = useMemo(() => {
    const available: typeof PROVIDER_OPTIONS = [];
    const alreadyAdded: typeof PROVIDER_OPTIONS = [];

    for (const option of PROVIDER_OPTIONS) {
      if (isProviderTypeAlreadyConfigured(option.id, configured)) {
        alreadyAdded.push(option);
      } else {
        available.push(option);
      }
    }

    return [...available, ...alreadyAdded];
  }, [configured]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger
        id={id}
        disabled={disabled}
        aria-label="Select provider"
        className={cn(
          "flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </PopoverTrigger>

      <PopoverContent align="start" sideOffset={4} className="overflow-hidden p-0">
        <Command className="rounded-lg bg-transparent p-0">
          <div className="border-b border-border/60 p-2 [&_[data-slot=command-input-wrapper]]:p-0">
            <CommandInput placeholder="Search providers…" />
          </div>
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>No provider found.</CommandEmpty>
            <CommandGroup className="p-1">
              <CommandItem
                value={`${BROWSE_OPTION.label} models.dev browse catalog free`}
                data-checked={value === BROWSE_OPTION.id ? true : undefined}
                onSelect={() => {
                  onValueChange(BROWSE_OPTION.id);
                  setOpen(false);
                }}
              >
                {BROWSE_OPTION.label}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup className="p-1">
              {sortedOptions.map((option) => {
                const alreadyConfigured = isProviderTypeAlreadyConfigured(option.id, configured);

                return (
                  <CommandItem
                    key={option.id}
                    value={`${option.label} ${option.id}`}
                    disabled={alreadyConfigured}
                    data-checked={value === option.id ? true : undefined}
                    onSelect={() => {
                      if (alreadyConfigured) {
                        return;
                      }

                      onValueChange(option.id);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {alreadyConfigured ? (
                      <span className="text-xs text-muted-foreground">Already added</span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const EMPTY_CONFIGURED_TYPES: ReadonlySet<string> = new Set();
