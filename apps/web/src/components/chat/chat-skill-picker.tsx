import type { SkillSummary } from "@nakama/core/contract";
import { cn } from "@nakama/ui/utils";
import { useEffect, useRef } from "react";
import type { ComposerSuggestion } from "@/lib/chat-composer-skills";

interface ChatSkillPickerProps {
  activeIndex: number;
  onSelect: (suggestion: ComposerSuggestion) => void;
  suggestions: ComposerSuggestion[];
}

function skillDescription(skill: SkillSummary): string | null {
  const trimmed = skill.description.trim();

  if (!trimmed || trimmed.toLowerCase() === skill.name.trim().toLowerCase()) {
    return null;
  }

  return trimmed;
}

function suggestionKey(suggestion: ComposerSuggestion): string {
  if (suggestion.kind === "mention") {
    return `mention:${suggestion.mention.name}`;
  }

  if (suggestion.kind === "plugin") {
    return `plugin:${suggestion.plugin.pluginId}`;
  }

  return suggestion.kind === "command"
    ? `command:${suggestion.command.name}`
    : `skill:${suggestion.skill.id}`;
}

function humanize(name: string): string {
  const spaced = name.replace(/-/g, " ");

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function suggestionTitle(suggestion: ComposerSuggestion): string {
  if (suggestion.kind === "mention") {
    return humanize(suggestion.mention.name);
  }

  if (suggestion.kind === "plugin") {
    return suggestion.plugin.label;
  }

  return suggestion.kind === "command"
    ? humanize(suggestion.command.name)
    : suggestion.skill.name;
}

function suggestionToken(suggestion: ComposerSuggestion): string | null {
  if (suggestion.kind === "mention") {
    return `@${suggestion.mention.name}`;
  }

  if (suggestion.kind === "plugin") {
    return `/open ${suggestion.plugin.pluginId}`;
  }

  return suggestion.kind === "command" ? `/${suggestion.command.name}` : null;
}

const SECTION_LABELS: Record<ComposerSuggestion["kind"], string> = {
  command: "Commands",
  mention: "Tools",
  plugin: "Plugins",
  skill: "Skills",
};

function suggestionDescription(suggestion: ComposerSuggestion): string | null {
  if (suggestion.kind === "mention") {
    return suggestion.mention.description;
  }

  if (suggestion.kind === "command") {
    return suggestion.command.description;
  }

  if (suggestion.kind === "plugin") {
    return null;
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
    <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md">
      <div
        aria-label="Available commands, skills and tools"
        className="max-h-[min(20rem,40dvh)] overflow-y-auto overscroll-contain p-1"
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
            const token = suggestionToken(suggestion);

            const startsSection =
              index === 0 || suggestions[index - 1].kind !== suggestion.kind;

            return (
              <div key={suggestionKey(suggestion)}>
                {startsSection ? (
                  <div
                    className={cn(
                      "px-2.5 pt-2 pb-0.5 font-medium text-2xs text-muted-foreground uppercase tracking-wider",
                      index > 0 && "mt-1 border-border border-t"
                    )}
                  >
                    {SECTION_LABELS[suggestion.kind]}
                  </div>
                ) : null}
                <button
                  aria-selected={active}
                  className={cn(
                    "flex w-full min-w-0 items-baseline gap-3 rounded-md px-2.5 py-1.5 text-left text-sm outline-none",
                    active ? "bg-muted text-foreground" : "hover:bg-muted/70"
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(suggestion);
                  }}
                  ref={active ? activeOptionRef : undefined}
                  role="option"
                  type="button"
                >
                  <span className="w-40 shrink-0 truncate font-medium">
                    {suggestionTitle(suggestion)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {description}
                  </span>
                  {token ? (
                    <span className="shrink-0 font-mono text-muted-foreground text-xs">
                      {token}
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })
        )}
      </div>
      <div className="flex gap-4 border-border border-t bg-muted/40 px-3 py-1.5 text-muted-foreground text-xs">
        <span>↑↓ Navigate</span>
        <span>↵ Select</span>
        <span>Tab Complete</span>
      </div>
    </div>
  );
}
