import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nakama/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@nakama/ui/popover";
import { ArrowDown01Icon } from "hugeicons-react";
import { type ReactNode, useState } from "react";

export interface SettingsModelOption {
  disabled?: boolean;
  label: string;
  value: string;
}

/** A model picker with search, as in the chat picker. */
export function SettingsModelSelect({
  ariaLabel,
  disabled,
  onValueChange,
  options,
  triggerLabel,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  options: SettingsModelOption[];
  triggerLabel: ReactNode;
  value: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={ariaLabel}
        className="flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
        disabled={disabled}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {triggerLabel}
        </span>
        <ArrowDown01Icon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-max min-w-72 max-w-[min(24rem,92vw)] p-0"
        sideOffset={4}
      >
        <Command className="rounded-lg bg-transparent p-0">
          <div className="border-border/60 border-b p-2 [&_[data-slot=command-input-wrapper]]:p-0">
            <CommandInput placeholder="Search models…" />
          </div>
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>No model found.</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                data-checked={option.value === value ? true : undefined}
                disabled={option.disabled}
                key={option.value}
                onSelect={() => {
                  setOpen(false);
                  onValueChange(option.value);
                }}
                value={`${option.label} ${option.value}`}
              >
                {option.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
