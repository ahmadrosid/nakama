import type { AgentQuestionnaire } from "@nakama/core/contract";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  isCustomChoice,
  type DraftAnswerState,
} from "@/components/chat/agent-questionnaire.shared";

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
  const customChoice = question.choices.find((choice) => isCustomChoice(choice));
  const showCustomInput = question.allowCustomAnswer || Boolean(customChoice);

  return (
    <section className="space-y-2.5">
      <p className="text-sm font-medium text-foreground">
        {questionIndex + 1}. {question.prompt}
      </p>
      {question.choices.length > 0 ? (
        <div className="space-y-1">
          {question.choices.map((choice) => {
            if (isCustomChoice(choice)) {
              const selected = state.selectedChoiceId === choice.id;

              return (
                <div key={choice.id} className="flex items-center gap-2.5 py-0.5">
                  <button
                    type="button"
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
                    className={cn(
                      "flex shrink-0 items-center gap-2.5 text-left text-sm transition-colors",
                      selected ? "text-primary" : "text-foreground",
                      disabled && "pointer-events-none opacity-50",
                    )}
                    aria-label={choice.label}
                  >
                    <span
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                        selected ? "border-primary" : "border-muted-foreground/40",
                      )}
                      aria-hidden
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full bg-primary transition-opacity",
                          selected ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </span>
                  </button>
                  <Input
                    value={state.customAnswer}
                    disabled={disabled}
                    placeholder={choice.label}
                    className="h-auto flex-1 border-0 bg-transparent! px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    onFocus={() =>
                      onStateChange({
                        ...state,
                        selectedChoiceId: choice.id,
                        selectedChoiceLabel: choice.label,
                      })
                    }
                    onChange={(event) =>
                      onStateChange({
                        ...state,
                        selectedChoiceId: choice.id,
                        selectedChoiceLabel: choice.label,
                        customAnswer: event.target.value,
                      })
                    }
                  />
                </div>
              );
            }

            const selected = state.selectedChoiceId === choice.id;

            return (
              <button
                key={choice.id}
                type="button"
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
                className={cn(
                  "flex w-full items-center gap-2.5 py-1 text-left text-sm transition-colors",
                  selected ? "text-primary" : "text-foreground",
                  disabled && "pointer-events-none opacity-50",
                )}
              >
                <span
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-primary" : "border-muted-foreground/40",
                  )}
                  aria-hidden
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full bg-primary transition-opacity",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </span>
                {choice.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {showCustomInput && !customChoice ? (
        <Input
          value={state.customAnswer}
          disabled={disabled}
          placeholder={question.placeholder || "Other (custom)"}
          onFocus={() =>
            onStateChange({
              ...state,
              selectedChoiceId: state.selectedChoiceId,
              selectedChoiceLabel: state.selectedChoiceLabel,
            })
          }
          onChange={(event) =>
            onStateChange({
              ...state,
              selectedChoiceId: state.selectedChoiceId,
              selectedChoiceLabel: state.selectedChoiceLabel,
              customAnswer: event.target.value,
            })
          }
        />
      ) : null}
    </section>
  );
}
