import type { AgentQuestionnaire } from "@nakama/core/contract";
import {
  type DraftAnswerState,
  isCustomChoice,
} from "@/components/chat/agent-questionnaire.shared";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
      <p className="font-medium text-foreground text-sm">
        {questionIndex + 1}. {question.prompt}
      </p>
      {question.choices.length > 0 ? (
        <div className="space-y-1">
          {question.choices.map((choice) => {
            if (isCustomChoice(choice)) {
              const selected = state.selectedChoiceId === choice.id;

              return (
                <div
                  className="flex items-center gap-2.5 py-0.5"
                  key={choice.id}
                >
                  <button
                    aria-label={choice.label}
                    className={cn(
                      "flex shrink-0 items-center gap-2.5 text-left text-sm transition-colors",
                      selected ? "text-primary" : "text-foreground",
                      disabled && "pointer-events-none opacity-50"
                    )}
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
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                        selected
                          ? "border-primary"
                          : "border-muted-foreground/40"
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full bg-primary transition-opacity",
                          selected ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </span>
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

            const selected = state.selectedChoiceId === choice.id;

            return (
              <button
                className={cn(
                  "flex w-full items-center gap-2.5 py-1 text-left text-sm transition-colors",
                  selected ? "text-primary" : "text-foreground",
                  disabled && "pointer-events-none opacity-50"
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
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-primary" : "border-muted-foreground/40"
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full bg-primary transition-opacity",
                      selected ? "opacity-100" : "opacity-0"
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
          disabled={disabled}
          onChange={(event) =>
            onStateChange({
              ...state,
              customAnswer: event.target.value,
              selectedChoiceId: state.selectedChoiceId,
              selectedChoiceLabel: state.selectedChoiceLabel,
            })
          }
          onFocus={() =>
            onStateChange({
              ...state,
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
