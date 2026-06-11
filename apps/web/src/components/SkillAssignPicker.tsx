import type { SkillSummary } from "@tinyclaw/core/contract";
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

interface SkillAssignPickerProps {
  skills: SkillSummary[];
  disabled?: boolean;
  onAssign: (skillId: string) => void | Promise<void>;
  className?: string;
}

function formatSkillMeta(skill: SkillSummary): string {
  const parts: string[] = [];

  if (skill.hasTool) {
    parts.push("includes tool");
  }

  if (skill.disableModelInvocation) {
    parts.push("explicit invoke only");
  }

  return parts.join(" · ");
}

export function SkillAssignPicker({
  skills,
  disabled = false,
  onAssign,
  className,
}: SkillAssignPickerProps) {
  const [open, setOpen] = useState(false);

  if (skills.length === 0) {
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
        Add skill
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="gap-1 border-b border-border px-6 py-4 text-left">
            <DialogTitle>Add skill</DialogTitle>
            <DialogDescription>
              Choose a workflow skill to allow for this profile.
            </DialogDescription>
          </DialogHeader>

          <Command className="rounded-none bg-transparent">
            <div className="border-b border-border/60 px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput placeholder="Search skills…" />
            </div>
            <CommandList className="max-h-72 p-1">
              <CommandEmpty>No skills found.</CommandEmpty>
              <CommandGroup>
                {skills.map((skill) => {
                  const meta = formatSkillMeta(skill);

                  return (
                    <CommandItem
                      key={skill.id}
                      value={`${skill.name} ${skill.description}`}
                      disabled={disabled}
                      onSelect={() => {
                        void onAssign(skill.id);
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0">
                        <p>{skill.name}</p>
                        <p className="text-xs text-muted-foreground">{skill.description}</p>
                        {meta ? (
                          <p className="text-xs text-muted-foreground/80">{meta}</p>
                        ) : null}
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
