import { cn } from "@nakama/ui/utils";

export function AgentQuestionnaireNav({
  currentQuestionIndex,
  answered,
}: {
  currentQuestionIndex: number;
  answered: boolean[];
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1">
      <p className="truncate font-medium text-foreground text-sm">Questions</p>
      <div className="flex items-center gap-2.5">
        <div aria-hidden className="flex gap-1">
          {answered.map((isAnswered, index) => (
            <span
              className={cn(
                "h-1 w-4 rounded-full transition-colors",
                isAnswered || index < currentQuestionIndex
                  ? "bg-primary"
                  : index === currentQuestionIndex
                    ? "bg-primary/40"
                    : "bg-muted-foreground/20"
              )}
              key={index}
            />
          ))}
        </div>
        <span className="text-muted-foreground text-xs">
          {currentQuestionIndex + 1} of {answered.length}
        </span>
      </div>
    </div>
  );
}
