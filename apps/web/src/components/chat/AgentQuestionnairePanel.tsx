import { hasActiveAgentQuestionnaire } from "@nakama/core/agent-questionnaire";
import type {
  AgentQuestionAnswer,
  AgentQuestionnaire,
} from "@nakama/core/contract";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type DraftAnswerState,
  isCustomChoice,
} from "@/components/chat/agent-questionnaire.shared";
import { AgentQuestionnaireNav } from "@/components/chat/agent-questionnaire-nav";
import { AgentQuestionnaireQuestion } from "@/components/chat/agent-questionnaire-question";
import { Button } from "@/components/ui/button";

interface AgentQuestionnairePanelProps {
  disabled?: boolean;
  onSubmit: (answers: AgentQuestionAnswer[]) => void;
  questionnaire: AgentQuestionnaire | null;
}

export function AgentQuestionnairePanel({
  questionnaire,
  disabled = false,
  onSubmit,
}: AgentQuestionnairePanelProps) {
  const [answers, setAnswers] = useState<Record<string, DraftAnswerState>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const activeQuestionRef = useRef<HTMLDivElement | null>(null);
  const [syncedQuestionnaire, setSyncedQuestionnaire] = useState(questionnaire);

  if (questionnaire !== syncedQuestionnaire) {
    setSyncedQuestionnaire(questionnaire);
    if (questionnaire) {
      setAnswers(
        Object.fromEntries(
          questionnaire.questions.map((question) => [
            question.id,
            {
              customAnswer: "",
              selectedChoiceId: null,
              selectedChoiceLabel: null,
            },
          ])
        )
      );
      setCurrentQuestionIndex(0);
    } else {
      setAnswers({});
      setCurrentQuestionIndex(0);
    }
  }

  const resolvedAnswers = useMemo(() => {
    if (!questionnaire) {
      return [];
    }

    return questionnaire.questions.map((question) => {
      const state = answers[question.id];
      const customChoice = question.choices.find((choice) =>
        isCustomChoice(choice)
      );
      const useCustomAnswer =
        (question.allowCustomAnswer || Boolean(customChoice)) &&
        (state?.customAnswer.trim().length ?? 0) > 0;
      const answer = useCustomAnswer
        ? (state?.customAnswer.trim() ?? "")
        : (state?.selectedChoiceLabel ?? "");
      return {
        answer,
        prompt: question.prompt,
        questionId: question.id,
      };
    });
  }, [answers, questionnaire]);

  const activeQuestionId = hasActiveAgentQuestionnaire(questionnaire)
    ? questionnaire?.questions[currentQuestionIndex]?.id
    : null;

  useEffect(() => {
    if (!activeQuestionId) {
      return;
    }

    const focusTarget = window.requestAnimationFrame(() => {
      const activeQuestionElement = activeQuestionRef.current;

      if (!activeQuestionElement) {
        return;
      }

      const input = activeQuestionElement.querySelector<HTMLInputElement>(
        "input:not(:disabled)"
      );
      const selectedOption =
        activeQuestionElement.querySelector<HTMLButtonElement>(
          "button[data-question-option='true'][data-selected='true']:not(:disabled)"
        );
      const firstOption =
        activeQuestionElement.querySelector<HTMLButtonElement>(
          "button[data-question-option='true']:not(:disabled)"
        );

      (input ?? selectedOption ?? firstOption)?.focus();
    });

    return () => window.cancelAnimationFrame(focusTarget);
  }, [activeQuestionId]);

  if (!hasActiveAgentQuestionnaire(questionnaire)) {
    return null;
  }

  const activeQuestionnaire = questionnaire!;
  const activeQuestion = activeQuestionnaire.questions[currentQuestionIndex]!;
  const activeState = answers[activeQuestion.id] ?? {
    customAnswer: "",
    selectedChoiceId: null,
    selectedChoiceLabel: null,
  };
  const canGoPrevious = currentQuestionIndex > 0;
  const canGoNext =
    currentQuestionIndex < activeQuestionnaire.questions.length - 1;
  const activeAnswer =
    resolvedAnswers[currentQuestionIndex]?.answer.trim() ?? "";
  const canSubmit = resolvedAnswers.some(
    (answer) => answer.answer.trim().length > 0
  );
  const canContinue = canGoNext ? activeAnswer.length > 0 : canSubmit;

  function handleContinue(): void {
    if (disabled || !canContinue) {
      return;
    }

    if (canGoNext) {
      setCurrentQuestionIndex((current) => current + 1);
      return;
    }

    onSubmit(resolvedAnswers);
  }

  function selectChoice(choiceIndex: number): void {
    const choice = activeQuestion.choices[choiceIndex];

    if (!choice) {
      return;
    }

    setAnswers((current) => ({
      ...current,
      [activeQuestion.id]: {
        ...activeState,
        selectedChoiceId: choice.id,
        selectedChoiceLabel: choice.label,
      },
    }));
  }

  function selectChoiceByOffset(offset: number): void {
    if (disabled || activeQuestion.choices.length === 0) {
      return;
    }

    const selectedIndex = activeQuestion.choices.findIndex(
      (choice) => choice.id === activeState.selectedChoiceId
    );
    const nextIndex =
      selectedIndex === -1
        ? offset > 0
          ? 0
          : activeQuestion.choices.length - 1
        : (selectedIndex + offset + activeQuestion.choices.length) %
          activeQuestion.choices.length;

    selectChoice(nextIndex);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectChoiceByOffset(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectChoiceByOffset(-1);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleContinue();
    }
  }

  function handleSkip(): void {
    if (canGoNext) {
      setCurrentQuestionIndex((current) => current + 1);
      return;
    }

    onSubmit(resolvedAnswers);
  }

  return (
    <div className="px-3">
      <aside
        aria-label="Agent questions"
        className="w-full overflow-hidden rounded-t-xl rounded-b-none border border-border bg-card shadow-xs"
      >
        <AgentQuestionnaireNav
          activeAnswerLength={activeAnswer.length}
          canGoNext={canGoNext}
          canGoPrevious={canGoPrevious}
          currentQuestionIndex={currentQuestionIndex}
          disabled={disabled}
          onNext={() => setCurrentQuestionIndex((current) => current + 1)}
          onPrevious={() => setCurrentQuestionIndex((current) => current - 1)}
          totalQuestions={activeQuestionnaire.questions.length}
        />
        <div className="space-y-4 px-3 py-3" onKeyDown={handleKeyDown}>
          <div key={activeQuestion.id} ref={activeQuestionRef}>
            <AgentQuestionnaireQuestion
              disabled={disabled}
              onStateChange={(nextState) =>
                setAnswers((current) => ({
                  ...current,
                  [activeQuestion.id]: nextState,
                }))
              }
              question={activeQuestion}
              questionIndex={currentQuestionIndex}
              state={activeState}
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <button
              className="text-muted-foreground text-sm transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              disabled={disabled}
              onClick={handleSkip}
              type="button"
            >
              Skip
            </button>
            <Button
              disabled={disabled || !canContinue}
              onClick={handleContinue}
              type="button"
            >
              {canGoNext ? "Continue" : "Submit"}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
