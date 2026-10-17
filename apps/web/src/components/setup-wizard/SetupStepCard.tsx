import { Card } from "@nakama/ui/card";
import { cn } from "@nakama/ui/utils";
import type { ReactNode } from "react";
import {
  SETUP_STEPS,
  type SetupStepId,
} from "@/components/setup-wizard/setup-wizard.shared";

interface SetupStepCardProps {
  children: ReactNode;
  currentStep: SetupStepId;
  /** Shown under the card, outside it. */
  footer?: ReactNode;
  heading: string;
}

export function SetupStepCard({
  children,
  currentStep,
  footer,
  heading,
}: SetupStepCardProps) {
  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <Card className="gap-0 p-6 sm:p-8">
        <ol aria-label="Setup progress" className="flex items-center gap-1.5">
          {SETUP_STEPS.map((step) => {
            const isCompleted = currentStep > step.id;
            const isCurrent = currentStep === step.id;

            return (
              <li
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color]",
                  isCurrent ? "w-6" : "w-1.5",
                  isCompleted || isCurrent ? "bg-primary" : "bg-border"
                )}
                key={step.id}
              >
                <span className="sr-only">
                  Step {step.id} of {SETUP_STEPS.length}: {step.label}
                  {isCompleted
                    ? ", completed"
                    : isCurrent
                      ? ", current"
                      : ", upcoming"}
                </span>
              </li>
            );
          })}
        </ol>
        <h1 className="mt-4 mb-6 font-semibold text-foreground text-xl">
          {heading}
        </h1>
        {children}
      </Card>
      {footer}
    </div>
  );
}
