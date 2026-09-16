import { parseUserContext, renderUserContext } from "@nakama/core/user-context";
import { FormField } from "@nakama/ui/form-field";
import { Input } from "@nakama/ui/input";
import { Textarea } from "@nakama/ui/textarea";
import { cn } from "@nakama/ui/utils";
import { type ReactNode, useState } from "react";
import { helpSuggestionsForContext } from "@/components/user-context-presets";

function useAnswers(value: string, onChange: (next: string) => void) {
  const parsed = parseUserContext(value);

  function setAnswer(key: string, next: string) {
    onChange(
      renderUserContext({ ...parsed.answers, [key]: next }, parsed.extra)
    );
  }

  return { ...parsed, setAnswer };
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** Small toggle pill used for quick picks. */
function Chip({
  children,
  disabled,
  onClick,
  selected,
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

interface UserContextFormProps {
  disabled?: boolean;
  /** Prefixes the input ids so two forms can coexist on one page. */
  idPrefix?: string;
  onChange: (nextContent: string) => void;
  /** Raw USER.md, shared by setup and the personalisation dialog. */
  value: string;
}

/** A free-form introduction with an optional, context-shaped follow-up. */
export function UserContextForm({
  value,
  onChange,
  disabled = false,
  idPrefix = "user-context",
}: UserContextFormProps) {
  const { answers, extra, setAnswer } = useAnswers(value, onChange);
  // Keep unfinished whitespace while typing; the saved notes are trimmed.
  const [introDraft, setIntroDraft] = useState<string | null>(null);
  const [customHelpOpen, setCustomHelpOpen] = useState<boolean | null>(null);
  const suggestions = helpSuggestionsForContext(
    [extra, answers.role, answers.projects].filter(Boolean).join(" ")
  );
  const help = answers.help ?? "";
  const selected = new Set(splitList(help));
  const suggestionSet = new Set(suggestions);
  const showCustomHelp =
    customHelpOpen ??
    (help !== "" && [...selected].some((item) => !suggestionSet.has(item)));

  function toggleHelp(suggestion: string) {
    const next = new Set(selected);
    if (next.has(suggestion)) {
      next.delete(suggestion);
    } else {
      next.add(suggestion);
    }
    setAnswer("help", [...next].join(", "));
  }

  return (
    <div className="space-y-6">
      <FormField
        id={`${idPrefix}-intro`}
        label="What should we know about you?"
      >
        <Textarea
          className="min-h-24 resize-y"
          disabled={disabled}
          id={`${idPrefix}-intro`}
          onChange={(event) => {
            setIntroDraft(event.target.value);
            onChange(renderUserContext(answers, event.target.value));
          }}
          placeholder="I'm Alex, a software engineer building my own product."
          value={introDraft ?? extra}
        />
      </FormField>

      {suggestions.length > 0 || help !== "" ? (
        <div className="space-y-3">
          <div
            aria-label="What would you like help with? (optional)"
            className="space-y-2"
            role="group"
          >
            <p className="font-medium text-sm">
              What would you like help with?{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <Chip
                  disabled={disabled}
                  key={suggestion}
                  onClick={() => toggleHelp(suggestion)}
                  selected={selected.has(suggestion)}
                >
                  {suggestion}
                </Chip>
              ))}
              <Chip
                disabled={disabled}
                onClick={() => setCustomHelpOpen(!showCustomHelp)}
                selected={showCustomHelp}
              >
                Something else
              </Chip>
            </div>
          </div>
          {showCustomHelp ? (
            <Input
              aria-label="What would you like help with?"
              disabled={disabled}
              onChange={(event) => setAnswer("help", event.target.value)}
              placeholder="Tell us in your own words"
              value={help}
            />
          ) : null}
        </div>
      ) : null}

      <details className="space-y-3">
        <summary className="cursor-pointer rounded-sm text-sm focus-visible:outline-ring">
          What Nakama will remember
        </summary>
        <Textarea
          aria-label="What Nakama will remember"
          className="min-h-40 text-sm"
          disabled={disabled}
          onChange={(event) => {
            setIntroDraft(null);
            onChange(event.target.value);
          }}
          placeholder="Nothing yet."
          value={value}
        />
      </details>
    </div>
  );
}
