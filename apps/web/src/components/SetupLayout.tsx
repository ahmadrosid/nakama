import type { ReactNode } from "react";
import { useAppContext } from "@/context/app-context";
import { cn } from "@/lib/utils";

interface SetupLayoutProps {
  children: ReactNode;
  step?: "provider" | "telegram" | "done";
}

const STEPS = [
  { id: "provider" as const, label: "Provider" },
  { id: "telegram" as const, label: "Telegram" },
];

export function SetupLayout({ children, step }: SetupLayoutProps) {
  const { error } = useAppContext();

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border/50 px-6 py-4">
        <img
          src="/tinyclaw.png"
          alt="TinyClaw"
          className="size-8 shrink-0 rounded-lg object-contain"
        />
        <p className="type-brand">TinyClaw</p>
      </header>

      {error ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex flex-1 flex-col items-center px-6 py-10">
        {step && step !== "done" ? (
          <nav
            aria-label="Setup progress"
            className="mb-8 flex w-full max-w-lg items-center gap-2"
          >
            {STEPS.map((setupStep, index) => {
              const stepIndex = STEPS.findIndex((item) => item.id === step);
              const isActive = setupStep.id === step;
              const isComplete = index < stepIndex;

              return (
                <div key={setupStep.id} className="flex min-w-0 flex-1 items-center gap-2">
                  {index > 0 ? (
                    <span
                      className={cn(
                        "h-px flex-1",
                        isComplete || isActive ? "bg-primary/50" : "bg-border",
                      )}
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-2 text-xs font-medium",
                      isActive
                        ? "text-foreground"
                        : isComplete
                          ? "text-muted-foreground"
                          : "text-muted-foreground/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full border text-[11px]",
                        isActive
                          ? "border-primary bg-primary/10 text-foreground"
                          : isComplete
                            ? "border-primary/40 bg-primary/5 text-muted-foreground"
                            : "border-border text-muted-foreground/60",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="hidden sm:inline">{setupStep.label}</span>
                  </span>
                </div>
              );
            })}
          </nav>
        ) : null}

        <main className="w-full max-w-lg">{children}</main>
      </div>
    </div>
  );
}
