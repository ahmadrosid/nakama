import type { ProfileSummary } from "@nakama/core/contract";
import { CheckmarkCircle02Icon, UserGroupIcon } from "hugeicons-react";
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

interface ComposioProfileAssignPickerProps {
  assignedProfileIds: string[];
  busy: boolean;
  onToggle: (profileId: string, assigned: boolean) => void;
  profiles: ProfileSummary[];
  toolkitName: string;
}

export function ComposioProfileAssignPicker({
  assignedProfileIds,
  busy,
  onToggle,
  profiles,
  toolkitName,
}: ComposioProfileAssignPickerProps) {
  const [open, setOpen] = useState(false);

  if (profiles.length === 0) {
    return null;
  }

  const assigned = new Set(assignedProfileIds);

  return (
    <>
      <Button
        disabled={busy}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <UserGroupIcon aria-hidden className="size-4" />
        {assigned.size === 1 ? "1 profile" : `${assigned.size} profiles`}
      </Button>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="gap-1 border-border border-b px-6 py-4 text-left">
            <DialogTitle>Profiles for {toolkitName}</DialogTitle>
            <DialogDescription>
              Pick which agents can use it. Changes save as you click, so the
              dialog stays open.
            </DialogDescription>
          </DialogHeader>

          <Command className="rounded-none bg-transparent">
            <div className="border-border/60 border-b px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput placeholder="Search profiles…" />
            </div>
            <CommandList className="max-h-72 p-1">
              <CommandEmpty>No profiles found.</CommandEmpty>
              <CommandGroup>
                {profiles.map((profile) => {
                  const isAssigned = assigned.has(profile.id);

                  return (
                    <CommandItem
                      key={profile.id}
                      onSelect={() => onToggle(profile.id, !isAssigned)}
                      value={profile.name}
                    >
                      <CheckmarkCircle02Icon
                        aria-hidden
                        className={cn(
                          "size-4 shrink-0",
                          isAssigned
                            ? "text-primary"
                            : "text-muted-foreground/40"
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground text-sm leading-tight">
                          {profile.name}
                        </p>
                        <p className="mt-0.5 text-muted-foreground text-xs leading-snug">
                          {isAssigned ? "Can use this toolkit" : "Not assigned"}
                          {profile.isSuper ? " · runs bash" : ""}
                        </p>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
