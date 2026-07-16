import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
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
    <div className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">Questions</p>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || !canGoPrevious}
          onClick={onPrevious}
          aria-label="Previous question"
          className="size-6 text-muted-foreground"
        >
          <ChevronUpIcon className="size-3.5" aria-hidden />
        </Button>
        <span className="min-w-10 text-center">
          {currentQuestionIndex + 1} of {totalQuestions}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || !canGoNext || activeAnswerLength === 0}
          onClick={onNext}
          aria-label="Next question"
          className="size-6 text-muted-foreground"
        >
          <ChevronDownIcon className="size-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
