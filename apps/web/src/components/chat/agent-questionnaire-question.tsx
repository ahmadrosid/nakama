import type { AgentQuestionnaire } from "@nakama/core/contract";
import { Input } from "@nakama/ui/input";
import { cn } from "@nakama/ui/utils";
import { PencilEdit02Icon, Tick02Icon } from "hugeicons-react";
import {
  type DraftAnswerState,
  isCustomChoice,
} from "@/components/chat/agent-questionnaire.shared";

const customInputRowClass =
  "flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-input bg-background px-3 shadow-xs transition-colors hover:border-ring/60 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20";

const customInputClass =
  "h-10 flex-1 border-0 bg-transparent! px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0";

function CustomAnswerInput({
  disabled,
  label,
  onChange,
  onFocus,
  placeholder,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label
      className={cn(
        customInputRowClass,
        "cursor-text",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <PencilEdit02Icon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="sr-only">{label}</span>
      <Input
        className={customInputClass}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

export function AgentQuestionnaireQuestion({
  question,
  state,
  disabled,
  onStateChange,
}: {
  question: AgentQuestionnaire["questions"][number];
  state: DraftAnswerState;
  disabled: boolean;
  onStateChange: (nextState: DraftAnswerState) => void;
}) {
  const customChoice = question.choices.find((choice) =>
    isCustomChoice(choice)
  );

  const showCustomInput = question.allowCustomAnswer || Boolean(customChoice);

  return (
    <section className="space-y-3">
      <p className="font-semibold text-base text-foreground leading-6">
        {question.prompt}
      </p>
      {question.choices.length > 0 ? (
        <div className="space-y-1.5">
          {question.choices.map((choice, choiceIndex) => {
            const selected = state.selectedChoiceId === choice.id;

            if (isCustomChoice(choice)) {
              return (
                <CustomAnswerInput
                  disabled={disabled}
                  key={choice.id}
                  label={choice.label}
                  onChange={(customAnswer) =>
                    onStateChange({
                      ...state,
                      customAnswer,
                      selectedChoiceId: choice.id,
                      selectedChoiceLabel: choice.label,
                    })
                  }
                  onFocus={() =>
                    onStateChange({
                      ...state,
                      selectedChoiceId: choice.id,
                      selectedChoiceLabel: choice.label,
                    })
                  }
                  placeholder={choice.label}
                  value={state.customAnswer}
                />
              );
            }

            return (
              <button
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-foreground text-sm transition-colors",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/60",
                  disabled && "pointer-events-none opacity-50"
                )}
                data-question-option="true"
                data-selected={selected}
                disabled={disabled}
                key={choice.id}
                onClick={() =>
                  onStateChange({
                    customAnswer: "",
                    selectedChoiceId: choice.id,
                    selectedChoiceLabel: choice.label,
                  })
                }
                type="button"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md font-semibold text-xs tabular-nums",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {choiceIndex + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                  {choice.label}
                  {choice.recommended ? (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
                      Recommended
                    </span>
                  ) : null}
                </span>
                {selected ? (
                  <Tick02Icon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-primary"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {showCustomInput && !customChoice ? (
        <CustomAnswerInput
          disabled={disabled}
          label="Other answer"
          onChange={(customAnswer) =>
            onStateChange({
              customAnswer,
              selectedChoiceId: null,
              selectedChoiceLabel: null,
            })
          }
          placeholder={question.placeholder || "Write another answer…"}
          value={state.customAnswer}
        />
      ) : null}
    </section>
  );
}
