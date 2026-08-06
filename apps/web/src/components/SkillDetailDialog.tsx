import { BookOpenIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useSkillQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import { cn } from "@/lib/utils";

interface SkillDetailDialogProps {
  skillId: string | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoveFromProfile?: (skillId: string, skillName: string) => void;
}

function formatSkillMeta(skill: {
  hasTool: boolean;
  disableModelInvocation: boolean;
}): string[] {
  const parts: string[] = [];

  if (skill.hasTool) {
    parts.push("includes tool");
  }

  if (skill.disableModelInvocation) {
    parts.push("explicit invoke only");
  }

  return parts;
}

export function SkillDetailDialog({
  skillId,
  busy,
  onOpenChange,
  onRemoveFromProfile,
}: SkillDetailDialogProps) {
  const {
    data: skill,
    isLoading,
    error,
  } = useSkillQuery(skillId);

  const errorMessage = error ? formatError(error) : null;
  const meta = skill ? formatSkillMeta(skill) : [];

  return (
    <Dialog open={Boolean(skillId)} onOpenChange={onOpenChange}>
      <DialogContent className="no-scrollbar flex max-h-[min(90dvh,85vh)] w-[calc(100%-1.5rem)] flex-col gap-4 overflow-y-auto p-4 sm:max-w-lg sm:gap-6 sm:p-6">
        {isLoading && !skill ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading skill…
          </div>
        ) : skill ? (
          <>
            <DialogHeader className="gap-2 pr-8 sm:gap-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground">
                  <BookOpenIcon className="size-4" aria-hidden />
                </span>
                {skill.name}
              </DialogTitle>
              {skill.description ? (
                <DialogDescription className="leading-relaxed">{skill.description}</DialogDescription>
              ) : (
                <DialogDescription className="sr-only">Skill details</DialogDescription>
              )}
              {meta.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {meta.map((label) => (
                    <span
                      key={label}
                      className="inline-flex w-fit items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}
            </DialogHeader>

            {errorMessage ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {errorMessage}
              </p>
            ) : null}

            <DialogFooter className="flex-col-reverse gap-2 border-t-0 bg-transparent p-0 pt-2 pb-2 sm:flex-row sm:justify-between sm:gap-3">
              {onRemoveFromProfile ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full sm:w-auto"
                  disabled={busy || isLoading}
                  onClick={() => onRemoveFromProfile(skill.id, skill.name)}
                >
                  <Trash2Icon className="size-4" aria-hidden />
                  Remove from profile
                </Button>
              ) : (
                <span className="hidden sm:block" />
              )}

              <Button
                type="button"
                variant="outline"
                className={cn("w-full sm:w-auto", onRemoveFromProfile && "sm:ml-auto")}
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </>
        ) : errorMessage ? (
          <>
            <DialogHeader>
              <DialogTitle>Skill details</DialogTitle>
              <DialogDescription>{errorMessage}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="border-t-0 bg-transparent p-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
