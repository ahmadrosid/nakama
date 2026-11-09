import { cn } from "@nakama/ui/utils";

export function AgentQuestionnaireNav({
  currentQuestionIndex,
  answered,
}: {
  currentQuestionIndex: number;
  answered: boolean[];
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
      <p className="truncate font-medium text-muted-foreground text-xs">
        Question {currentQuestionIndex + 1} of {answered.length}
      </p>
      <div aria-hidden className="flex gap-1">
        {answered.map((isAnswered, index) => (
          <span
            className={cn(
              "h-1 w-5 rounded-full transition-colors",
              isAnswered || index <= currentQuestionIndex
                ? "bg-primary"
                : "bg-muted-foreground/20"
            )}
            key={index}
          />
        ))}
      </div>
    </div>
  );
}
