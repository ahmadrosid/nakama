import { useState, useCallback, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { SetupWizardStepper } from "@/components/setup-wizard/SetupWizardStepper";
import { SetupStepOrganization } from "@/components/setup-wizard/SetupStepOrganization";
import { SetupStepAccount } from "@/components/setup-wizard/SetupStepAccount";
import { SetupStepProvider } from "@/components/setup-wizard/SetupStepProvider";
import { SetupStepUserContext } from "@/components/setup-wizard/SetupStepUserContext";
import { pathForPage } from "@/lib/navigation";

export interface SetupOrganizationDraft {
  name: string;
  slug: string;
}

export interface SetupAccountDraft {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export const SETUP_STEPS = [
  { id: 1, label: "Account", required: true },
  { id: 2, label: "Organization", required: true },
  { id: 3, label: "Provider", required: true },
  { id: 4, label: "About You", required: false },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]["id"];

export interface SetupWizardProps {
  onComplete?: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<SetupStepId>(1);
  const [accountDraft, setAccountDraft] = useState<SetupAccountDraft | null>(null);

  useEffect(() => {
    if (currentStep === 2 && !accountDraft) {
      setCurrentStep(1);
    }
  }, [currentStep, accountDraft]);

  const goNext = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev >= 4) {
        return 4;
      }
      return (prev + 1) as SetupStepId;
    });
  }, []);

  const goSkip = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev >= 4) {
        return 4;
      }
      return (prev + 1) as SetupStepId;
    });
  }, []);

  const goBack = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev <= 1) {
        return 1;
      }
      return (prev - 1) as SetupStepId;
    });
  }, []);

  const handleComplete = useCallback(() => {
    if (onComplete) {
      onComplete();
    } else {
      navigate(pathForPage("chat"), { replace: true });
    }
  }, [navigate, onComplete]);

  const handleStepAdvance = useCallback(() => {
    if (currentStep >= 4) {
      handleComplete();
    } else {
      goNext();
    }
  }, [currentStep, goNext, handleComplete]);

  const handleSkip = useCallback(() => {
    if (currentStep >= 4) {
      handleComplete();
    } else {
      goSkip();
    }
  }, [currentStep, goSkip, handleComplete]);

  const heading =
    currentStep === 1
      ? "Create your admin account"
      : currentStep === 2
        ? "Create your organization"
        : currentStep === 3
          ? "Welcome to Nakama"
          : "Tell us about yourself";

  const subtitle =
    currentStep === 1
      ? "Set up your admin account to secure the dashboard."
      : currentStep === 2
        ? "Every workspace lives inside an organization. Name yours to finish setup."
        : currentStep === 3
          ? "Set up your AI provider to get started. You can add more later."
          : "Help the agent understand your preferences — optional.";

  function renderStep(): ReactNode {
    switch (currentStep) {
      case 1:
        return (
          <SetupStepAccount
            onNext={(account) => {
              setAccountDraft(account);
              goNext();
            }}
          />
        );
      case 2:
        if (!accountDraft) {
          return null;
        }
        return (
          <SetupStepOrganization
            account={accountDraft}
            onNext={handleStepAdvance}
            onBack={goBack}
          />
        );
      case 3:
        return <SetupStepProvider onNext={() => handleStepAdvance()} />;
      case 4:
        return (
          <SetupStepUserContext
            onNext={handleStepAdvance}
            onSkip={handleSkip}
            onBack={goBack}
          />
        );
      default:
        throw new Error(`Unexpected setup step: ${currentStep}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">{heading}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <SetupWizardStepper currentStep={currentStep} />

      <div key={currentStep}>{renderStep()}</div>
    </div>
  );
}
