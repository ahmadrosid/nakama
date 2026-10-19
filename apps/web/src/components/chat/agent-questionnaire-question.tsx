import type { AgentQuestionnaire } from "@nakama/core/contract";
import { Input } from "@nakama/ui/input";
import { cn } from "@nakama/ui/utils";
import {
  type DraftAnswerState,
  isCustomChoice,
} from "@/components/chat/agent-questionnaire.shared";

const optionRowClass =
  "flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-foreground text-sm transition-colors";

function optionStateClass(selected: boolean, disabled: boolean): string {
  return cn(
    selected ? "bg-muted font-medium" : "hover:bg-muted/60",
    disabled && "pointer-events-none opacity-50"
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
    <section className="space-y-2">
      <p className="font-medium text-foreground text-sm">{question.prompt}</p>
      {question.choices.length > 0 ? (
        <div className="space-y-0.5">
          {question.choices.map((choice, choiceIndex) => {
            const selected = state.selectedChoiceId === choice.id;

            if (isCustomChoice(choice)) {
              return (
                <div
                  className={cn(
                    optionRowClass,
                    selected ? "bg-muted" : "hover:bg-muted/60",
                    disabled && "pointer-events-none opacity-50"
                  )}
                  key={choice.id}
                >
                  <button
                    aria-label={choice.label}
                    className="flex size-10 shrink-0 items-center justify-center text-muted-foreground tabular-nums"
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
                    {choiceIndex + 1}.
                  </button>
                  <Input
                    className="h-10 flex-1 border-0 bg-transparent! px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
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
                <span
                  aria-hidden
                  className="w-5 shrink-0 text-muted-foreground tabular-nums"
                >
                  {choiceIndex + 1}.
                </span>
                {choice.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {showCustomInput && !customChoice ? (
        <Input
          className="min-h-10 rounded-md border-dashed"
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
