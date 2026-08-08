import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SetupStepAccount } from "@/components/setup-wizard/SetupStepAccount";
import { SetupStepOrganization } from "@/components/setup-wizard/SetupStepOrganization";
import { SetupStepProvider } from "@/components/setup-wizard/SetupStepProvider";
import { SetupStepUserContext } from "@/components/setup-wizard/SetupStepUserContext";
import { SetupWizardStepper } from "@/components/setup-wizard/SetupWizardStepper";
import type {
  SetupAccountDraft,
  SetupStepId,
  SetupWizardProps,
} from "@/components/setup-wizard/setup-wizard.shared";
import { useAppContext } from "@/context/use-app-context";
import { client } from "@/lib/client";
import { pathForPage } from "@/lib/navigation";

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const navigate = useNavigate();
  const { health } = useAppContext();
  const userAlreadyConfigured = health?.userConfigured === true;
  const firstStep: SetupStepId = userAlreadyConfigured ? 3 : 1;
  const [currentStep, setCurrentStep] = useState<SetupStepId>(firstStep);
  const [accountDraft, setAccountDraft] = useState<SetupAccountDraft | null>(
    null
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.location?.origin) {
      return;
    }

    void client.updateWebPublicUrl(window.location.origin).catch(() => {
      // Fresh install persists during POST /v1/auth/setup instead.
    });
  }, []);

  useEffect(() => {
    if (!userAlreadyConfigured && currentStep === 2 && !accountDraft) {
      setCurrentStep(1);
    }
  }, [currentStep, accountDraft, userAlreadyConfigured]);

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
      if (prev <= firstStep) {
        return firstStep;
      }
      return (prev - 1) as SetupStepId;
    });
  }, [firstStep]);

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
      ? "Set up your admin account to secure the dashboard, or restore a backup ZIP from a previous install."
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
            onBack={goBack}
            onNext={handleStepAdvance}
          />
        );
      case 3:
        return <SetupStepProvider onNext={() => handleStepAdvance()} />;
      case 4:
        return (
          <SetupStepUserContext
            onBack={goBack}
            onNext={handleStepAdvance}
            onSkip={handleSkip}
          />
        );
      default:
        throw new Error(`Unexpected setup step: ${currentStep}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-semibold text-foreground text-xl">{heading}</h1>
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      </div>

      <SetupWizardStepper currentStep={currentStep} />

      <div key={currentStep}>{renderStep()}</div>
    </div>
  );
}
