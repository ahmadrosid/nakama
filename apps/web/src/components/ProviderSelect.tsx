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
import { PROVIDER_OPTIONS, type SelectedProvider } from "@/lib/models";
import { cn } from "@/lib/utils";

export type ProviderSelectValue = SelectedProvider | "__browse__";

interface ProviderSelectProps {
  id?: string;
  value: ProviderSelectValue;
  onValueChange: (value: ProviderSelectValue) => void;
  disabled?: boolean;
  className?: string;
}

const BROWSE_OPTION = {
  id: "__browse__" as const,
  label: "Browse models.dev…",
};

export function ProviderSelect({
  id,
  value,
  onValueChange,
  disabled = false,
  className,
}: ProviderSelectProps) {
  const [open, setOpen] = useState(false);

  const selectedLabel = useMemo(() => {
    if (value === "__browse__") {
      return BROWSE_OPTION.label;
    }

    return PROVIDER_OPTIONS.find((option) => option.id === value)?.label ?? value;
  }, [value]);

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
              {PROVIDER_OPTIONS.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.label} ${option.id}`}
                  data-checked={value === option.id ? true : undefined}
                  onSelect={() => {
                    onValueChange(option.id);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup className="p-1">
              <CommandItem
                value={`${BROWSE_OPTION.label} models.dev browse catalog`}
                data-checked={value === BROWSE_OPTION.id ? true : undefined}
                onSelect={() => {
                  onValueChange(BROWSE_OPTION.id);
                  setOpen(false);
                }}
              >
                {BROWSE_OPTION.label}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
