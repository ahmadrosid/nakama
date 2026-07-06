import type { SkillSummary } from "@nakama/core/contract";
import { CheckIcon, WandSparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatSkillPickerProps {
  skills: SkillSummary[];
  activeIndex: number;
  onSelect: (skill: SkillSummary) => void;
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
      className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      role="listbox"
      aria-label="Available skills"
    >
      {skills.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">No matching skills</div>
      ) : (
        skills.map((skill, index) => {
          const active = index === activeIndex;
          const description = skillDescription(skill);
          const meta = skillMeta(skill);

          return (
            <button
              key={skill.id}
              type="button"
              role="option"
              aria-selected={active}
              className={cn(
                "flex w-full min-w-0 items-center gap-3 rounded-sm px-3 py-2 text-left text-sm outline-none",
                active ? "bg-muted text-foreground" : "hover:bg-muted/70",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(skill);
              }}
            >
              <WandSparklesIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium leading-tight">{skill.name}</span>
                {description ? (
                  <span className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground">
                    {description}
                  </span>
                ) : null}
              </span>
              {meta ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  {meta}
                </span>
              ) : null}
              {active ? <CheckIcon className="size-4 shrink-0" aria-hidden /> : null}
            </button>
          );
        })
      )}
    </div>
  );
}
