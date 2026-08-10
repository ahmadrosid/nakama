import { ArrowDown01Icon, ArrowUp01Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";

export function AgentQuestionnaireNav({
  currentQuestionIndex,
  totalQuestions,
  disabled,
  canGoPrevious,
  canGoNext,
  activeAnswerLength,
  onPrevious,
  onNext,
}: {
  currentQuestionIndex: number;
  totalQuestions: number;
  disabled: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  activeAnswerLength: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-border/60 border-b px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground text-sm">
          Questions
        </p>
      </div>
      <div className="flex items-center gap-1 text-muted-foreground text-xs">
        <Button
          aria-label="Previous question"
          className="size-6 text-muted-foreground"
          disabled={disabled || !canGoPrevious}
          onClick={onPrevious}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ArrowUp01Icon aria-hidden className="size-3.5" />
        </Button>
        <span className="min-w-10 text-center">
          {currentQuestionIndex + 1} of {totalQuestions}
        </span>
        <Button
          aria-label="Next question"
          className="size-6 text-muted-foreground"
          disabled={disabled || !canGoNext || activeAnswerLength === 0}
          onClick={onNext}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ArrowDown01Icon aria-hidden className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
