import type { UserContextStatusResponse } from "@nakama/core";
import {
  parseUserContext,
  renderUserContext,
  USER_CONTEXT_FIELDS,
  type UserContextAnswers,
} from "@nakama/core/user-context";
import { MoreHorizontalIcon } from "hugeicons-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  browserLanguageLabel,
  isPresetRole,
  joinAlways,
  joinReplies,
  REPLY_LANGUAGES,
  REPLY_LENGTH,
  REPLY_TONE,
  ROLE_PRESETS,
  splitAlways,
  splitReplies,
  workHintsForRole,
} from "@/components/user-context-presets";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Shared plumbing: the raw USER.md string is the only state.          */
/* ------------------------------------------------------------------ */

interface SectionProps {
  disabled: boolean;
  idPrefix: string;
  onChange: (nextContent: string) => void;
  value: string;
}

function fieldByKey(key: string) {
  const field = USER_CONTEXT_FIELDS.find((candidate) => candidate.key === key);
  if (!field) {
    throw new Error(`Unknown USER.md field: ${key}`);
  }
  return field;
}

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

function AnswerInput({
  answers,
  disabled,
  idPrefix,
  fieldKey,
  placeholder,
  setAnswer,
}: {
  answers: UserContextAnswers;
  disabled: boolean;
  fieldKey: string;
  idPrefix: string;
  placeholder?: string;
  setAnswer: (key: string, next: string) => void;
}) {
  const field = fieldByKey(fieldKey);
  const inputId = `${idPrefix}-${field.key}`;

  return (
    <FormField density="compact" id={inputId} label={field.label}>
      <Input
        autoComplete="off"
        disabled={disabled}
        id={inputId}
        onChange={(event) => setAnswer(field.key, event.target.value)}
        placeholder={placeholder ?? field.placeholder}
        value={answers[field.key] ?? ""}
      />
    </FormField>
  );
}

/** Selectable tile used for roles and reply styles. */
function ChoiceCard({
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
        "flex h-full flex-col items-start gap-2 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow,transform] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "border-primary bg-primary/5 shadow-[inset_0_0_0_1px_var(--color-primary)]"
          : "border-border bg-card hover:border-foreground/30 hover:bg-muted/40"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/** Small toggle pill used for quick picks. */
function Chip({
  children,
  disabled,
  onClick,
  selected,
  tag,
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
  selected: boolean;
  tag?: string;
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
      {tag ? (
        <span
          className={cn(
            "rounded-full px-1.5 text-[0.65rem] leading-4",
            selected
              ? "bg-primary-foreground/20"
              : "bg-muted text-muted-foreground"
          )}
        >
          {tag}
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Section 1: who you are                                              */
/* ------------------------------------------------------------------ */

function AboutSection({ value, onChange, disabled, idPrefix }: SectionProps) {
  const { answers, setAnswer } = useAnswers(value, onChange);
  const role = answers.role ?? "";
  const customRole = role !== "" && !isPresetRole(role);
  const [customOpen, setCustomOpen] = useState(customRole);
  const showCustom = customOpen || customRole;
  const customInputId = `${idPrefix}-role`;

  return (
    <div className="space-y-5">
      <AnswerInput
        answers={answers}
        disabled={disabled}
        fieldKey="name"
        idPrefix={idPrefix}
        setAnswer={setAnswer}
      />

      <div className="space-y-2">
        <p className="font-medium text-foreground text-sm">What you do</p>
        <div
          aria-label="What you do"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          id={`${idPrefix}-role-grid`}
          role="group"
        >
          {ROLE_PRESETS.map((preset) => (
            <ChoiceCard
              disabled={disabled}
              key={preset.label}
              onClick={() => {
                setCustomOpen(false);
                setAnswer("role", preset.label);
              }}
              selected={role === preset.label}
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground">
                <preset.Icon aria-hidden className="size-4" />
              </span>
              <span className="font-medium text-foreground text-sm leading-tight">
                {preset.label}
              </span>
            </ChoiceCard>
          ))}

          <ChoiceCard
            disabled={disabled}
            onClick={() => {
              setCustomOpen(true);
              if (isPresetRole(role)) {
                setAnswer("role", "");
              }
            }}
            selected={showCustom}
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground">
              <MoreHorizontalIcon aria-hidden className="size-4" />
            </span>
            <span className="font-medium text-foreground text-sm leading-tight">
              Something else
            </span>
          </ChoiceCard>
        </div>

        {showCustom ? (
          <Input
            aria-label="What you do"
            autoComplete="off"
            autoFocus={customOpen && !customRole}
            disabled={disabled}
            id={customInputId}
            onChange={(event) => setAnswer("role", event.target.value)}
            placeholder="Indie game developer, high school teacher, ops lead..."
            value={isPresetRole(role) ? "" : role}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section 2: what you work on, shaped by the role picked before       */
/* ------------------------------------------------------------------ */

function WorkSection({ value, onChange, disabled, idPrefix }: SectionProps) {
  const { answers, setAnswer } = useAnswers(value, onChange);
  const hints = workHintsForRole(answers.role ?? "");
  const stackItems = splitList(answers.stack ?? "");
  const stackLower = new Set(stackItems.map((item) => item.toLowerCase()));

  function toggleChip(chip: string) {
    const next = stackLower.has(chip.toLowerCase())
      ? stackItems.filter((item) => item.toLowerCase() !== chip.toLowerCase())
      : [...stackItems, chip];
    setAnswer("stack", next.join(", "));
  }

  return (
    <div className="space-y-5">
      <AnswerInput
        answers={answers}
        disabled={disabled}
        fieldKey="projects"
        idPrefix={idPrefix}
        placeholder={hints.projects}
        setAnswer={setAnswer}
      />

      <div className="space-y-2">
        <AnswerInput
          answers={answers}
          disabled={disabled}
          fieldKey="stack"
          idPrefix={idPrefix}
          placeholder={hints.stack}
          setAnswer={setAnswer}
        />
        <div
          aria-label="Quick picks for tech stack"
          className="flex flex-wrap gap-1.5"
          role="group"
        >
          {hints.chips.map((chip) => (
            <Chip
              disabled={disabled}
              key={chip}
              onClick={() => toggleChip(chip)}
              selected={stackLower.has(chip.toLowerCase())}
            >
              {chip}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section 3: how replies should sound                                 */
/* ------------------------------------------------------------------ */

function StyleSection({ value, onChange, disabled, idPrefix }: SectionProps) {
  const { answers, setAnswer } = useAnswers(value, onChange);
  const { picked, custom } = splitReplies(answers.replies ?? "");
  const length = REPLY_LENGTH.find((option) => picked.includes(option.value));
  const tone = REPLY_TONE.find((option) => picked.includes(option.value));

  const { language, rest: alwaysRest } = splitAlways(answers.always ?? "");
  const knownLanguage = REPLY_LANGUAGES.some(
    (entry) => entry.label === language
  );
  const customLanguage = language !== "" && !knownLanguage;
  const [otherLanguageOpen, setOtherLanguageOpen] = useState(customLanguage);
  const showOtherLanguage = otherLanguageOpen || customLanguage;
  const [suggested] = useState(browserLanguageLabel);

  function choose(group: "length" | "tone", next: string | undefined): void {
    const nextLength = group === "length" ? next : length?.value;
    const nextTone = group === "tone" ? next : tone?.value;
    setAnswer(
      "replies",
      joinReplies(
        [nextLength, nextTone].filter((part): part is string => !!part),
        custom
      )
    );
  }

  function chooseLanguage(next: string) {
    setAnswer("always", joinAlways(next, alwaysRest));
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="font-medium text-foreground text-sm">Reply language</p>
        <div
          aria-label="Reply language"
          className="flex flex-wrap gap-1.5"
          role="group"
        >
          {REPLY_LANGUAGES.map((entry) => (
            <Chip
              disabled={disabled}
              key={entry.code}
              onClick={() => {
                setOtherLanguageOpen(false);
                chooseLanguage(language === entry.label ? "" : entry.label);
              }}
              selected={language === entry.label}
              tag={
                suggested === entry.label && language !== entry.label
                  ? "suggested"
                  : undefined
              }
            >
              {entry.label}
            </Chip>
          ))}
          <Chip
            disabled={disabled}
            onClick={() => {
              setOtherLanguageOpen(true);
              if (knownLanguage) {
                chooseLanguage("");
              }
            }}
            selected={showOtherLanguage}
          >
            Other
          </Chip>
        </div>
        {showOtherLanguage ? (
          <Input
            aria-label="Reply language"
            autoComplete="off"
            autoFocus={otherLanguageOpen && !customLanguage}
            disabled={disabled}
            id={`${idPrefix}-language`}
            onChange={(event) => chooseLanguage(event.target.value)}
            placeholder="Nederlands, Tiếng Việt, Türkçe..."
            value={knownLanguage ? "" : language}
          />
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="font-medium text-foreground text-sm">Length</p>
        <div
          aria-label="Length"
          className="flex flex-wrap gap-1.5"
          role="group"
        >
          {REPLY_LENGTH.map((option) => (
            <Chip
              disabled={disabled}
              key={option.value}
              onClick={() =>
                choose(
                  "length",
                  length?.value === option.value ? undefined : option.value
                )
              }
              selected={length?.value === option.value}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-medium text-foreground text-sm">Tone</p>
        <div aria-label="Tone" className="flex flex-wrap gap-1.5" role="group">
          {REPLY_TONE.map((option) => (
            <Chip
              disabled={disabled}
              key={option.value}
              onClick={() =>
                choose(
                  "tone",
                  tone?.value === option.value ? undefined : option.value
                )
              }
              selected={tone?.value === option.value}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </div>

      <FormField
        density="compact"
        id={`${idPrefix}-replies-custom`}
        label="Anything else about replies?"
      >
        <Input
          autoComplete="off"
          disabled={disabled}
          id={`${idPrefix}-replies-custom`}
          onChange={(event) =>
            setAnswer("replies", joinReplies(picked, event.target.value))
          }
          placeholder="Code before prose, no emojis, always show the command first..."
          value={custom}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          density="compact"
          id={`${idPrefix}-always`}
          label={fieldByKey("always").label}
        >
          <Input
            autoComplete="off"
            disabled={disabled}
            id={`${idPrefix}-always`}
            onChange={(event) =>
              setAnswer("always", joinAlways(language, event.target.value))
            }
            placeholder="Cite the file you read from"
            value={alwaysRest}
          />
        </FormField>
        <AnswerInput
          answers={answers}
          disabled={disabled}
          fieldKey="never"
          idPrefix={idPrefix}
          setAnswer={setAnswer}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section 4: what gets saved                                          */
/* ------------------------------------------------------------------ */

function ReviewSection({ value, onChange, disabled }: SectionProps) {
  return (
    <Textarea
      aria-label="USER.md content"
      className="min-h-48 font-mono text-sm"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Nothing yet."
      value={value}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Drafts and defaults, shared by the wizard step and the dialog        */
/* ------------------------------------------------------------------ */

const DRAFT_PREFIX = "nakama:user-context-draft:";

function readDraft(orgId: string | null | undefined): string | null {
  if (!orgId) {
    return null;
  }
  try {
    return localStorage.getItem(DRAFT_PREFIX + orgId);
  } catch {
    return null;
  }
}

export function writeUserContextDraft(
  orgId: string | null | undefined,
  content: string
): void {
  if (!orgId) {
    return;
  }
  try {
    localStorage.setItem(DRAFT_PREFIX + orgId, content);
  } catch {}
}

export function clearUserContextDraft(orgId: string | null | undefined): void {
  if (!orgId) {
    return;
  }
  try {
    localStorage.removeItem(DRAFT_PREFIX + orgId);
  } catch {}
}

/**
 * Local editor state for USER.md. Starts from the saved file; when that is
 * empty it falls back to a draft left by "Set up later", then to just the
 * account name so the first question is already answered.
 */
export function useUserContextEditor(input: {
  defaultName: string | null | undefined;
  orgId: string | null | undefined;
  /** Re-initialise when this flips, e.g. a dialog opening. */
  resetKey?: boolean;
  status: UserContextStatusResponse | undefined;
}) {
  const { status, orgId, defaultName, resetKey } = input;
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");

  useEffect(() => {
    if (!status) {
      return;
    }
    const saved = status.content ?? "";
    const draft = saved === "" ? readDraft(orgId) : null;
    const name = defaultName?.trim() ?? "";
    const fallback =
      saved === "" && name !== "" ? renderUserContext({ name }) : saved;
    setContent(draft ?? fallback);
    setSavedContent(saved);
  }, [status, orgId, defaultName, resetKey]);

  return { content, savedContent, setContent, setSavedContent };
}

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

export const USER_CONTEXT_SECTIONS = [
  {
    Component: AboutSection,
    id: "about",
    title: "What do you do?",
  },
  {
    Component: WorkSection,
    id: "work",
    title: "What are you working on?",
  },
  {
    Component: StyleSection,
    id: "style",
    title: "How should replies sound?",
  },
  {
    Component: ReviewSection,
    id: "review",
    title: "What Nakama will remember",
  },
] as const;

interface UserContextFormProps {
  disabled?: boolean;
  /** Prefixes the input ids so two forms can coexist on one page. */
  idPrefix?: string;
  onChange: (nextContent: string) => void;
  /** Raw USER.md. Every section is a view over this string, not separate state. */
  value: string;
}

/**
 * All sections stacked, for the settings dialog. The review textarea starts
 * collapsed unless the file already holds hand-written notes.
 */
export function UserContextForm({
  value,
  onChange,
  disabled = false,
  idPrefix = "user-context",
}: UserContextFormProps) {
  const hasExtra = parseUserContext(value).extra !== "";
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    if (hasExtra) {
      setReviewOpen(true);
    }
  }, [hasExtra]);

  const questionSections = USER_CONTEXT_SECTIONS.filter(
    (section) => section.id !== "review"
  );

  return (
    <div className="space-y-6">
      {questionSections.map((section) => (
        <section className="space-y-3" key={section.id}>
          <h3 className="font-medium text-foreground text-sm">
            {section.title}
          </h3>
          <section.Component
            disabled={disabled}
            idPrefix={idPrefix}
            onChange={onChange}
            value={value}
          />
        </section>
      ))}

      <div className="space-y-2">
        <Button
          disabled={disabled}
          onClick={() => setReviewOpen((open) => !open)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {reviewOpen ? "Hide USER.md" : "Review USER.md"}
        </Button>
        {reviewOpen ? (
          <ReviewSection
            disabled={disabled}
            idPrefix={idPrefix}
            onChange={onChange}
            value={value}
          />
        ) : null}
      </div>
    </div>
  );
}
