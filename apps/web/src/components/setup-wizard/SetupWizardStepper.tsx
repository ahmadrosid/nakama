import { SETUP_STEPS, type SetupStepId } from "@/components/setup-wizard/SetupWizard";
import { cn } from "@/lib/utils";

interface SetupWizardStepperProps {
  currentStep: SetupStepId;
}

export function SetupWizardStepper({ currentStep }: SetupWizardStepperProps) {
  const current = SETUP_STEPS.find((step) => step.id === currentStep)!;

  return (
    <nav aria-label="Setup progress" className="space-y-2">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <p className="text-muted-foreground">
          Step {currentStep} of {SETUP_STEPS.length}
        </p>
        <p className="font-medium text-foreground">{current.label}</p>
      </div>

      <ol className="flex items-center gap-1">
        {SETUP_STEPS.map((step, index) => {
          const isCompleted = currentStep > step.id;
          const isCurrent = currentStep === step.id;

          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex flex-1 items-center gap-1",
                index === 3 && "ml-1.5",
              )}
            >
              <div
                className={cn(
                  "h-1 w-full rounded-full transition-colors",
                  isCompleted || isCurrent ? "bg-primary" : "bg-border",
                )}
              />
              <span className="sr-only">
                {step.label}
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
    </nav>
  );
}
