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

const PROVIDER_PREFIX = "provider:";

export interface SettingsModelOption {
  disabled?: boolean;
  label: string;
  /** The model name alone, shown in the Model picker. */
  name?: string;
  /** Options with a provider go in the Model picker under that provider. */
  provider?: { id: string; label: string };
  value: string;
}

/**
 * A Provider picker and a Model picker. Options with no provider (None, Off)
 * are picked from the Provider list and leave the Model picker empty.
 */
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
  // A provider picked before its model; nothing saves until a model is picked.
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(
    null
  );

  const selected = options.find((option) => option.value === value);
  const providerId = pendingProviderId ?? selected?.provider?.id ?? null;

  const providers = [
    ...new Map(
      options.flatMap((option) =>
        option.provider ? [[option.provider.id, option.provider] as const] : []
      )
    ).values(),
  ];

  const providerOptions: SettingsModelOption[] = [
    ...options.filter((option) => !option.provider),
    ...providers.map((provider) => ({
      disabled: options.every(
        (option) => option.provider?.id !== provider.id || option.disabled
      ),
      label: provider.label,
      value: `${PROVIDER_PREFIX}${provider.id}`,
    })),
  ];

  const modelOptions = options
    .filter((option) => option.provider && option.provider.id === providerId)
    .map((option) => ({ ...option, label: option.name ?? option.label }));

  const providerLabel = providerId
    ? providers.find((provider) => provider.id === providerId)?.label
    : selected
      ? selected.label
      : triggerLabel;

  const modelPicked = Boolean(
    selected?.provider && selected.provider.id === providerId
  );

  const modelLabel =
    modelPicked && selected
      ? (selected.name ?? selected.label)
      : providerId
        ? "Choose model"
        : "—";

  return (
    <div className="grid w-full grid-cols-2 gap-2">
      <SettingsPicker
        ariaLabel={`${ariaLabel} provider`}
        disabled={disabled}
        emptyLabel="No provider found."
        onValueChange={(next) => {
          if (!next.startsWith(PROVIDER_PREFIX)) {
            setPendingProviderId(null);
            onValueChange(next);

            return;
          }

          const nextId = next.slice(PROVIDER_PREFIX.length);

          if (nextId === selected?.provider?.id) {
            setPendingProviderId(null);

            return;
          }

          const choices = options.filter(
            (option) => option.provider?.id === nextId && !option.disabled
          );

          // One model leaves nothing to choose.
          if (choices.length === 1) {
            setPendingProviderId(null);
            onValueChange(choices[0].value);

            return;
          }

          setPendingProviderId(nextId);
        }}
        options={providerOptions}
        searchPlaceholder="Search providers…"
        triggerLabel={providerLabel}
        value={providerId ? `${PROVIDER_PREFIX}${providerId}` : value}
      />
      <SettingsPicker
        ariaLabel={`${ariaLabel} model`}
        disabled={disabled || !providerId}
        emptyLabel="No model found."
        onValueChange={(next) => {
          setPendingProviderId(null);
          onValueChange(next);
        }}
        options={modelOptions}
        searchPlaceholder="Search models…"
        triggerLabel={
          <span className={modelPicked ? undefined : "text-muted-foreground"}>
            {modelLabel}
          </span>
        }
        value={value}
      />
    </div>
  );
}

/** One picker with search, as in the chat picker. */
export function SettingsPicker({
  ariaLabel,
  disabled,
  emptyLabel,
  onValueChange,
  options,
  searchPlaceholder,
  triggerLabel,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  emptyLabel: string;
  onValueChange: (value: string) => void;
  options: SettingsModelOption[];
  searchPlaceholder: string;
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
        // A fixed width, so filtering the list does not resize it.
        className="w-(--anchor-width) min-w-72 max-w-[min(24rem,92vw)] p-0"
        sideOffset={4}
      >
        <Command className="rounded-lg bg-transparent p-0">
          <div className="border-border/60 border-b p-2 [&_[data-slot=command-input-wrapper]]:p-0">
            <CommandInput placeholder={searchPlaceholder} />
          </div>
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
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
