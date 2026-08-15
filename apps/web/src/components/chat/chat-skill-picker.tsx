import type { SkillSummary } from "@nakama/core/contract";
import { CheckmarkCircle01Icon, SparklesIcon } from "hugeicons-react";
import { cn } from "@/lib/utils";

interface ChatSkillPickerProps {
  activeIndex: number;
  onSelect: (skill: SkillSummary) => void;
  skills: SkillSummary[];
}

function skillDescription(skill: SkillSummary): string | null {
  const trimmed = skill.description.trim();
  if (!trimmed || trimmed.toLowerCase() === skill.name.trim().toLowerCase()) {
    return null;
  }

  return trimmed;
}

function skillMeta(skill: SkillSummary): string | null {
  const parts: string[] = [];

  if (skill.hasTool) {
    parts.push("tool");
  }

  if (skill.disableModelInvocation) {
    parts.push("explicit");
  }

  return parts.join(" · ") || null;
}

export function ChatSkillPicker({
  skills,
  activeIndex,
  onSelect,
}: ChatSkillPickerProps) {
  return (
    <div
      aria-label="Available skills"
      className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      role="listbox"
    >
      {skills.length === 0 ? (
        <div className="px-3 py-2 text-muted-foreground text-sm">
          No matching skills
        </div>
      ) : (
        skills.map((skill, index) => {
          const active = index === activeIndex;
          const description = skillDescription(skill);
          const meta = skillMeta(skill);

          return (
            <button
              aria-selected={active}
              className={cn(
                "flex w-full min-w-0 items-center gap-3 rounded-sm px-3 py-2 text-left text-sm outline-none",
                active ? "bg-muted text-foreground" : "hover:bg-muted/70"
              )}
              key={skill.id}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(skill);
              }}
              role="option"
              type="button"
            >
              <SparklesIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium leading-tight">
                  {skill.name}
                </span>
                {description ? (
                  <span className="mt-0.5 line-clamp-1 text-muted-foreground text-xs leading-snug">
                    {description}
                  </span>
                ) : null}
              </span>
              {meta ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-2xs text-muted-foreground uppercase">
                  {meta}
                </span>
              ) : null}
              {active ? (
                <CheckmarkCircle01Icon
                  aria-hidden
                  className="size-4 shrink-0"
                />
              ) : null}
            </button>
          );
        })
      )}
    </div>
  );
}
