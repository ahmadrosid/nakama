import type { SkillSummary } from "@nakama/core/contract";
import { CheckmarkCircle01Icon, SparklesIcon } from "hugeicons-react";
import type { ComposerSlashSuggestion } from "@/lib/chat-composer-skills";
import { cn } from "@/lib/utils";

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
  return (
    <div
      aria-label="Available slash commands and skills"
      className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
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
                "flex w-full min-w-0 items-center gap-3 rounded-sm px-3 py-2 text-left text-sm outline-none",
                active ? "bg-muted text-foreground" : "hover:bg-muted/70"
              )}
              key={suggestionKey(suggestion)}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(suggestion);
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
                  {suggestionTitle(suggestion)}
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
