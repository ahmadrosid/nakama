import type { AgentQuestionnaire } from "@nakama/core/contract";
import { Input } from "@nakama/ui/input";
import { cn } from "@nakama/ui/utils";
import {
  type DraftAnswerState,
  isCustomChoice,
} from "@/components/chat/agent-questionnaire.shared";

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-4 shrink-0 rounded-full border bg-background transition-all",
        selected ? "border-[5px] border-primary" : "border-muted-foreground/40"
      )}
    />
  );
}

const optionRowClass =
  "flex min-h-11 w-full items-center gap-3 rounded-lg border px-3.5 text-left text-foreground text-sm transition-colors";

function optionStateClass(selected: boolean, disabled: boolean): string {
  return cn(
    selected
      ? "border-primary bg-primary/5"
      : "border-transparent bg-muted/60 hover:bg-muted",
    disabled && "pointer-events-none opacity-50"
  );
}

export function AgentQuestionnaireQuestion({
  questionIndex,
  question,
  state,
  disabled,
  onStateChange,
}: {
  questionIndex: number;
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
    <section className="space-y-2.5">
      <p className="font-medium text-base text-foreground">
        {questionIndex + 1}. {question.prompt}
      </p>
      {question.choices.length > 0 ? (
        <div className="space-y-1.5">
          {question.choices.map((choice) => {
            const selected = state.selectedChoiceId === choice.id;

            if (isCustomChoice(choice)) {
              return (
                <div
                  className={cn(
                    optionRowClass,
                    "border-dashed",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/30",
                    disabled && "pointer-events-none opacity-50"
                  )}
                  key={choice.id}
                >
                  <button
                    aria-label={choice.label}
                    className="flex shrink-0 items-center"
                    data-question-option="true"
                    data-selected={selected}
                    disabled={disabled}
                    onClick={() =>
                      onStateChange({
                        ...state,
                        selectedChoiceId: choice.id,
                        selectedChoiceLabel: choice.label,
                      })
                    }
                    type="button"
                  >
                    <RadioDot selected={selected} />
                  </button>
                  <Input
                    className="h-auto flex-1 border-0 bg-transparent! px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    disabled={disabled}
                    onChange={(event) =>
                      onStateChange({
                        ...state,
                        customAnswer: event.target.value,
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
                </div>
              );
            }

            return (
              <button
                className={cn(
                  optionRowClass,
                  optionStateClass(selected, disabled)
                )}
                data-question-option="true"
                data-selected={selected}
                disabled={disabled}
                key={choice.id}
                onClick={() =>
                  onStateChange({
                    ...state,
                    selectedChoiceId: choice.id,
                    selectedChoiceLabel: choice.label,
                  })
                }
                type="button"
              >
                <RadioDot selected={selected} />
                {choice.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {showCustomInput && !customChoice ? (
        <Input
          className="min-h-11 rounded-lg border-dashed"
          disabled={disabled}
          onChange={(event) =>
            onStateChange({
              ...state,
              customAnswer: event.target.value,
              selectedChoiceId: state.selectedChoiceId,
              selectedChoiceLabel: state.selectedChoiceLabel,
            })
          }
          placeholder={question.placeholder || "Other (custom)"}
          value={state.customAnswer}
        />
      ) : null}
    </section>
  );
}
