import { ArrowRightIcon, CheckCircle2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProviderSetupForm } from "@/components/ProviderSetupForm";
import { SetupLayout } from "@/components/SetupLayout";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAppContext } from "@/context/app-context";
import { useModelsQuery } from "@/hooks/use-app-queries";
import { pathForPage } from "@/lib/navigation";

type WizardStep = "provider" | "telegram" | "done";

export function SetupWizardPage() {
  const navigate = useNavigate();
  const { health } = useAppContext();
  const { isLoading: catalogLoading } = useModelsQuery();
  const providerConfigured = health?.providerConfigured === true;
  const [step, setStep] = useState<WizardStep>(() =>
    providerConfigured ? "telegram" : "provider",
  );

  useEffect(() => {
    if (providerConfigured && step === "provider") {
      setStep("telegram");
    }
  }, [providerConfigured, step]);

  const goToChat = useCallback(() => {
    navigate(pathForPage("chat"), { replace: true });
  }, [navigate]);

  if (catalogLoading) {
    return (
      <SetupLayout>
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      </SetupLayout>
    );
  }

  if (step === "done") {
    return (
      <SetupLayout step="done">
        <div className="space-y-6 text-center">
          <div className="flex justify-center">
            <CheckCircle2Icon className="size-12 text-emerald-400" aria-hidden />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-foreground">You&apos;re all set</h1>
            <p className="text-sm text-muted-foreground">
              TinyClaw is ready. Start a chat or explore the app.
            </p>
          </div>
          <Button type="button" onClick={goToChat}>
            Go to Chat
            <ArrowRightIcon className="size-4" />
          </Button>
        </div>
      </SetupLayout>
    );
  }

  if (step === "telegram") {
    return (
      <SetupLayout step="telegram">
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-foreground">Connect Telegram</h1>
            <p className="text-sm text-muted-foreground">
              Optional — link your bot to chat from Telegram. You can set this up later in
              Settings.
            </p>
          </div>

          <TelegramSettingsCard
            embedded
            submitLabel="Save & finish"
            onSaveSuccess={() => setStep("done")}
          />

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setStep("done")}>
              Skip for now
            </Button>
          </div>
        </div>
      </SetupLayout>
    );
  }

  return (
    <SetupLayout step="provider">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">Welcome to TinyClaw</h1>
          <p className="text-sm text-muted-foreground">
            Connect your LLM provider to enable chat. Credentials are saved on the server.
          </p>
        </div>

        <ProviderSetupForm
          submitLabel="Continue"
          showHeading={false}
          onSuccess={() => setStep("telegram")}
        />
      </div>
    </SetupLayout>
  );
}
