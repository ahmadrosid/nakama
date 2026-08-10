import type { ComposioToolkitSummary } from "@nakama/core/contract";
import { Add01Icon } from "hugeicons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ComposioToolkitAssignPickerProps {
  buttonLabel?: string;
  className?: string;
  disabled?: boolean;
  onAssign: (toolkitId: string) => void | Promise<void>;
  toolkits: ComposioToolkitSummary[];
}

function toolkitStatusLabel(status: ComposioToolkitSummary["status"]): string {
  return status === "enabled" ? "Enabled for org" : "Disabled";
}

export function ComposioToolkitAssignPicker({
  toolkits,
  disabled = false,
  buttonLabel = "Assign toolkit",
  onAssign,
  className,
}: ComposioToolkitAssignPickerProps) {
  const [open, setOpen] = useState(false);

  if (toolkits.length === 0) {
    return null;
  }

  return (
    <>
      <Button
        className={cn("w-full sm:w-auto", className)}
        disabled={disabled}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Add01Icon aria-hidden className="size-4" />
        {buttonLabel}
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
        }}
        open={open}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="gap-1 border-border border-b px-6 py-4 text-left">
            <DialogTitle>Assign Composio toolkit</DialogTitle>
            <DialogDescription>
              Choose an org-enabled toolkit to allow for this profile.
            </DialogDescription>
          </DialogHeader>

          <Command className="rounded-none bg-transparent">
            <div className="border-border/60 border-b px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput placeholder="Search toolkits…" />
            </div>
            <CommandList className="max-h-72 p-1">
              <CommandEmpty>No toolkits found.</CommandEmpty>
              <CommandGroup>
                {toolkits.map((toolkit) => (
                  <CommandItem
                    key={toolkit.id}
                    onSelect={() => {
                      void onAssign(toolkit.id);
                      setOpen(false);
                    }}
                    value={`${toolkit.displayName} ${toolkit.toolkitSlug}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground text-sm leading-tight">
                        {toolkit.displayName}
                      </p>
                      <p className="mt-0.5 text-muted-foreground text-xs leading-snug">
                        {toolkitStatusLabel(toolkit.status)}
                        {toolkit.cachedTools.length > 0
                          ? ` · ${toolkit.cachedTools.length} tool${toolkit.cachedTools.length === 1 ? "" : "s"}`
                          : ""}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
