import type { ComposioToolkitSummary } from "@nakama/core/contract";
import { PlusIcon } from "lucide-react";
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
  toolkits: ComposioToolkitSummary[];
  disabled?: boolean;
  buttonLabel?: string;
  onAssign: (toolkitId: string) => void | Promise<void>;
  className?: string;
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
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className={cn("w-full sm:w-auto", className)}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4" aria-hidden />
        {buttonLabel}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="gap-1 border-b border-border px-6 py-4 text-left">
            <DialogTitle>Assign Composio toolkit</DialogTitle>
            <DialogDescription>
              Choose an org-enabled toolkit to allow for this profile.
            </DialogDescription>
          </DialogHeader>

          <Command className="rounded-none bg-transparent">
            <div className="border-b border-border/60 px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput placeholder="Search toolkits…" />
            </div>
            <CommandList className="max-h-72 p-1">
              <CommandEmpty>No toolkits found.</CommandEmpty>
              <CommandGroup>
                {toolkits.map((toolkit) => (
                  <CommandItem
                    key={toolkit.id}
                    value={`${toolkit.displayName} ${toolkit.toolkitSlug}`}
                    onSelect={() => {
                      void onAssign(toolkit.id);
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium leading-tight text-foreground">
                        {toolkit.displayName}
                      </p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
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
