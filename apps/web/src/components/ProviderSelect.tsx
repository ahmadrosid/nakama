import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@nakama/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@nakama/ui/popover";
import { cn } from "@nakama/ui/utils";
import { ArrowDown01Icon } from "hugeicons-react";
import { useMemo, useState } from "react";
import {
  isProviderTypeAlreadyConfigured,
  PROVIDER_OPTIONS,
  type SelectedProvider,
} from "@/lib/models";

type ProviderSelectValue = SelectedProvider | "__browse__";

interface ProviderSelectProps {
  className?: string;
  configuredTypes?: ReadonlySet<string>;
  disabled?: boolean;
  id?: string;
  onValueChange: (value: ProviderSelectValue) => void;
  value: ProviderSelectValue;
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
    // As a value it names what is shown, not the action that opened it.
    if (value === "__browse__") {
      return "Free models";
    }

    return (
      PROVIDER_OPTIONS.find((option) => option.id === value)?.label ?? value
    );
  }, [value]);

  const optionGroups = useMemo(() => {
    const groups = PROVIDER_OPTION_GROUPS.map((group) => {
      const options: typeof PROVIDER_OPTIONS = [];

      return { heading: group.heading, options };
    });

    const alreadyAdded: typeof PROVIDER_OPTIONS = [];

    for (const option of PROVIDER_OPTIONS) {
      if (isProviderTypeAlreadyConfigured(option.id, configured)) {
        alreadyAdded.push(option);

        continue;
      }

      const index = PROVIDER_OPTION_GROUPS.findIndex(
        (group) => group.ids?.has(option.id) ?? true
      );

      groups[index]!.options.push(option);
    }

    groups.push({ heading: "Already added", options: alreadyAdded });

    return groups.filter((group) => group.options.length > 0);
  }, [configured]);

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
      }}
      open={open}
    >
      <PopoverTrigger
        aria-label="Select provider"
        className={cn(
          "flex h-8 w-full cursor-pointer select-none items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
          className
        )}
        disabled={disabled}
        id={id}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selectedLabel}
        </span>
        <ArrowDown01Icon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="overflow-hidden p-0"
        sideOffset={4}
      >
        <Command className="rounded-lg bg-transparent p-0">
          <div className="border-border/60 border-b p-2 [&_[data-slot=command-input-wrapper]]:p-0">
            <CommandInput placeholder="Search providers…" />
          </div>
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>No provider found.</CommandEmpty>
            <CommandGroup className="p-1">
              <CommandItem
                data-checked={value === BROWSE_OPTION.id ? true : undefined}
                onSelect={() => {
                  onValueChange(BROWSE_OPTION.id);
                  setOpen(false);
                }}
                value={`${BROWSE_OPTION.label} models.dev browse catalog free`}
              >
                {BROWSE_OPTION.label}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            {optionGroups.map((group) => (
              <CommandGroup
                className="p-1"
                heading={group.heading}
                key={group.heading}
              >
                {group.options.map((option) => {
                  const alreadyConfigured = isProviderTypeAlreadyConfigured(
                    option.id,
                    configured
                  );

                  return (
                    <CommandItem
                      data-checked={value === option.id ? true : undefined}
                      disabled={alreadyConfigured}
                      key={option.id}
                      onSelect={() => {
                        if (alreadyConfigured) {
                          return;
                        }

                        onValueChange(option.id);
                        setOpen(false);
                      }}
                      value={`${option.label} ${option.id}`}
                    >
                      {option.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const EMPTY_CONFIGURED_TYPES: ReadonlySet<string> = new Set();

// The last group has no ids: it takes every provider the others do not list.
const PROVIDER_OPTION_GROUPS: Array<{
  heading: string;
  ids?: ReadonlySet<SelectedProvider>;
}> = [
  {
    heading: "Sign in with your plan",
    ids: new Set<SelectedProvider>(["chatgpt", "xai_oauth"]),
  },
  {
    heading: "Local or custom",
    ids: new Set<SelectedProvider>(["ollama", "openai_compatible"]),
  },
  { heading: "API key" },
];
