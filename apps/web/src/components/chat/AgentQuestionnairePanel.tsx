import { hasActiveAgentQuestionnaire } from "@nakama/core/agent-questionnaire";
import type { AgentQuestionAnswer, AgentQuestionnaire } from "@nakama/core/contract";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentQuestionnaireNav } from "@/components/chat/agent-questionnaire-nav";
import { AgentQuestionnaireQuestion } from "@/components/chat/agent-questionnaire-question";
import {
  isCustomChoice,
  type DraftAnswerState,
} from "@/components/chat/agent-questionnaire.shared";
import { Button } from "@/components/ui/button";

interface AgentQuestionnairePanelProps {
  questionnaire: AgentQuestionnaire | null;
  disabled?: boolean;
  onSubmit: (answers: AgentQuestionAnswer[]) => void;
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
    if (!questionnaire) {
      setAnswers({});
      setCurrentQuestionIndex(0);
    } else {
      setAnswers(
        Object.fromEntries(
          questionnaire.questions.map((question) => [
            question.id,
            {
              selectedChoiceId: null,
              selectedChoiceLabel: null,
              customAnswer: "",
            },
          ]),
        ),
      );
      setCurrentQuestionIndex(0);
    }
  }

  const resolvedAnswers = useMemo(() => {
    if (!questionnaire) {
      return [];
    }

    return questionnaire.questions.map((question) => {
      const state = answers[question.id];
      const customChoice = question.choices.find((choice) => isCustomChoice(choice));
      const useCustomAnswer =
        (question.allowCustomAnswer || Boolean(customChoice)) &&
        (state?.customAnswer.trim().length ?? 0) > 0;
      const answer = useCustomAnswer
        ? state?.customAnswer.trim() ?? ""
        : state?.selectedChoiceLabel ?? "";
      return {
        questionId: question.id,
        prompt: question.prompt,
        answer,
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
        "input:not(:disabled)",
      );
      const selectedOption = activeQuestionElement.querySelector<HTMLButtonElement>(
        "button[data-question-option='true'][data-selected='true']:not(:disabled)",
      );
      const firstOption = activeQuestionElement.querySelector<HTMLButtonElement>(
        "button[data-question-option='true']:not(:disabled)",
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
    selectedChoiceId: null,
    selectedChoiceLabel: null,
    customAnswer: "",
  };
  const canGoPrevious = currentQuestionIndex > 0;
  const canGoNext = currentQuestionIndex < activeQuestionnaire.questions.length - 1;
  const activeAnswer = resolvedAnswers[currentQuestionIndex]?.answer.trim() ?? "";
  const canSubmit = resolvedAnswers.some((answer) => answer.answer.trim().length > 0);
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
      (choice) => choice.id === activeState.selectedChoiceId,
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
        className="w-full overflow-hidden rounded-t-xl rounded-b-none border border-border bg-card shadow-xs"
        aria-label="Agent questions"
      >
        <AgentQuestionnaireNav
          currentQuestionIndex={currentQuestionIndex}
          totalQuestions={activeQuestionnaire.questions.length}
          disabled={disabled}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          activeAnswerLength={activeAnswer.length}
          onPrevious={() => setCurrentQuestionIndex((current) => current - 1)}
          onNext={() => setCurrentQuestionIndex((current) => current + 1)}
        />
        <div className="space-y-4 px-3 py-3" onKeyDown={handleKeyDown}>
          <div ref={activeQuestionRef} key={activeQuestion.id}>
            <AgentQuestionnaireQuestion
              questionIndex={currentQuestionIndex}
              question={activeQuestion}
              state={activeState}
              disabled={disabled}
              onStateChange={(nextState) =>
                setAnswers((current) => ({
                  ...current,
                  [activeQuestion.id]: nextState,
                }))
              }
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              disabled={disabled}
              onClick={handleSkip}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              Skip
            </button>
            <Button type="button" disabled={disabled || !canContinue} onClick={handleContinue}>
              {canGoNext ? "Continue" : "Submit"}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
