import type { SkillSummary } from "@tinyclaw/core/contract";
import { CheckIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
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
  assignedSkillIds?: ReadonlySet<string>;
  disabled?: boolean;
  buttonLabel?: string;
  onAssign: (skillId: string) => void | Promise<void>;
  onDelete?: (skillId: string) => void | Promise<void>;
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

function skillDescription(skill: SkillSummary): string | null {
  const trimmed = skill.description.trim();
  if (!trimmed || trimmed.toLowerCase() === skill.name.trim().toLowerCase()) {
    return null;
  }

  return trimmed;
}

function assignSkill(
  skillId: string,
  onAssign: (skillId: string) => void | Promise<void>,
  setOpen: (open: boolean) => void,
) {
  void onAssign(skillId);
  setOpen(false);
}

export function SkillAssignPicker({
  skills,
  assignedSkillIds = new Set(),
  disabled = false,
  buttonLabel = "Add skill",
  onAssign,
  onDelete,
  className,
}: SkillAssignPickerProps) {
  const [open, setOpen] = useState(false);

  const availableSkills = skills.filter((skill) => !assignedSkillIds.has(skill.id));
  const onProfileSkills = skills.filter((skill) => assignedSkillIds.has(skill.id));

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
        className={className}
        onClick={() => setOpen(true)}
      >
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
            <DialogTitle>Manage skills</DialogTitle>
            <DialogDescription>
              Add skills to this profile, or delete them from your library.
            </DialogDescription>
          </DialogHeader>

          <Command className="rounded-none bg-transparent">
            <div className="border-b border-border/60 px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0">
              <CommandInput placeholder="Search skills…" />
            </div>
            <CommandList className="max-h-72 p-2">
              <CommandEmpty>No skills found.</CommandEmpty>

              {availableSkills.length > 0 ? (
                <CommandGroup heading="Add to profile" className="space-y-1">
                  {availableSkills.map((skill) => {
                    const meta = formatSkillMeta(skill);
                    const description = skillDescription(skill);

                    return (
                      <CommandItem
                        key={skill.id}
                        value={`${skill.name} ${skill.description}`}
                        disabled={disabled}
                        className={cn(
                          "items-center gap-3 px-3 py-2.5",
                          onDelete && "[&>svg:last-child]:hidden",
                        )}
                        onSelect={() => {
                          assignSkill(skill.id, onAssign, setOpen);
                        }}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="truncate text-sm font-medium leading-none">{skill.name}</p>
                          {description ? (
                            <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                              {description}
                            </p>
                          ) : (
                            <p className="text-xs leading-snug text-muted-foreground">
                              Not on this profile yet
                            </p>
                          )}
                          {meta ? (
                            <p className="text-xs leading-snug text-muted-foreground/80">{meta}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={disabled}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              assignSkill(skill.id, onAssign, setOpen);
                            }}
                          >
                            <PlusIcon aria-hidden />
                            Add
                          </Button>
                          {onDelete ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground/60 hover:text-destructive"
                              disabled={disabled}
                              aria-label={`Delete ${skill.name} from library`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void onDelete(skill.id);
                              }}
                            >
                              <Trash2Icon className="size-4" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}

              {availableSkills.length > 0 && onProfileSkills.length > 0 ? (
                <CommandSeparator className="my-2" />
              ) : null}

              {onProfileSkills.length > 0 ? (
                <CommandGroup heading="Already on this profile" className="space-y-1">
                  {onProfileSkills.map((skill) => {
                    const meta = formatSkillMeta(skill);
                    const description = skillDescription(skill);

                    return (
                      <CommandItem
                        key={skill.id}
                        value={`${skill.name} ${skill.description}`}
                        className={cn(
                          "cursor-default items-center gap-3 bg-muted/20 px-3 py-2.5 data-selected:bg-muted/20",
                          onDelete && "[&>svg:last-child]:hidden",
                        )}
                        onSelect={() => {}}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium leading-none text-muted-foreground">
                              {skill.name}
                            </p>
                            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              <CheckIcon className="size-3" aria-hidden />
                              On profile
                            </span>
                          </div>
                          {description ? (
                            <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                              {description}
                            </p>
                          ) : null}
                          {meta ? (
                            <p className="text-xs leading-snug text-muted-foreground/80">{meta}</p>
                          ) : null}
                        </div>
                        {onDelete ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 self-center text-muted-foreground/60 hover:text-destructive"
                            disabled={disabled}
                            aria-label={`Delete ${skill.name} from library`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void onDelete(skill.id);
                            }}
                          >
                            <Trash2Icon className="size-4" aria-hidden />
                          </Button>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
