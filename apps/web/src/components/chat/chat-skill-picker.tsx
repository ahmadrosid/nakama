import type { SkillSummary } from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import { useEffect, useRef } from "react";
import type { ComposerSlashSuggestion } from "@/lib/chat-composer-skills";

interface ChatSkillPickerProps {
  activeIndex: number;
  onSelect: (suggestion: ComposerSlashSuggestion) => void;
  suggestions: ComposerSlashSuggestion[];
}

function skillDescription(skill: SkillSummary): string | null {
  const trimmed = skill.description.trim();
  if (!trimmed || trimmed.toLowerCase() === skill.name.trim().toLowerCase()) {
    return null;
  }

  return trimmed;
}

function skillMeta(skill: SkillSummary): string {
  const parts = ["skill"];

  if (skill.hasTool) {
    parts.push("tool");
  }

  if (skill.disableModelInvocation) {
    parts.push("explicit");
  }

  return parts.join(" · ");
}

function suggestionKey(suggestion: ComposerSlashSuggestion): string {
  return suggestion.kind === "command"
    ? `command:${suggestion.command.name}`
    : `skill:${suggestion.skill.id}`;
}

function suggestionTitle(suggestion: ComposerSlashSuggestion): string {
  return suggestion.kind === "command"
    ? `/${suggestion.command.name}`
    : suggestion.skill.name;
}

function suggestionDescription(
  suggestion: ComposerSlashSuggestion
): string | null {
  if (suggestion.kind === "command") {
    return suggestion.command.description;
  }

  return skillDescription(suggestion.skill);
}

export function ChatSkillPicker({
  suggestions,
  activeIndex,
  onSelect,
}: ChatSkillPickerProps) {
  const activeOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, suggestions]);

  return (
    <div
      aria-label="Available slash commands and skills"
      className="absolute bottom-full left-0 z-30 mb-2 max-h-[min(20rem,40dvh)] w-full max-w-md overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-sm"
      role="listbox"
    >
      {suggestions.length === 0 ? (
        <div className="px-3 py-2 text-muted-foreground text-sm">
          No matching skills
        </div>
      ) : (
        suggestions.map((suggestion, index) => {
          const active = index === activeIndex;
          const description = suggestionDescription(suggestion);
          const meta =
            suggestion.kind === "skill"
              ? skillMeta(suggestion.skill)
              : "command";

          return (
            <button
              aria-selected={active}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                active ? "bg-muted text-foreground" : "hover:bg-muted/70"
              )}
              key={suggestionKey(suggestion)}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(suggestion);
              }}
              ref={active ? activeOptionRef : undefined}
              role="option"
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium leading-tight">
                  {suggestionTitle(suggestion)}
                </span>
                {description ? (
                  <span className="line-clamp-1 text-muted-foreground text-xs leading-tight">
                    {description}
                  </span>
                ) : null}
              </span>
              {meta ? (
                <span className="shrink-0 rounded bg-muted px-1 font-medium text-2xs text-muted-foreground uppercase">
                  {meta}
                </span>
              ) : null}
            </button>
          );
        })
      )}
    </div>
  );
}
