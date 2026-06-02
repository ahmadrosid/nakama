import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ProviderSetupForm } from "@/components/ProviderSetupForm";
import { SetupLayout } from "@/components/SetupLayout";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAppContext } from "@/context/app-context";
import { useModelsQuery } from "@/hooks/use-app-queries";
import { pathForPage } from "@/lib/navigation";

export function SetupWizardPage() {
  const navigate = useNavigate();
  const { health } = useAppContext();
  const { isLoading: catalogLoading } = useModelsQuery();
  const providerConfigured = health?.providerConfigured === true;

  const goToChat = useCallback(() => {
    navigate(pathForPage("chat"), { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (providerConfigured) {
      goToChat();
    }
  }, [providerConfigured, goToChat]);

  if (catalogLoading || providerConfigured) {
    return (
      <SetupLayout>
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      </SetupLayout>
    );
  }

  return (
    <SetupLayout>
      <div className="space-y-8">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">Welcome to TinyClaw</h1>
          <p className="text-sm text-muted-foreground">
            Connect a provider to start chatting. Telegram is optional and can be set up here or
            in Settings later.
          </p>
        </div>

        <Card className="w-full">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Appearance</p>
              <p className="text-xs text-muted-foreground">Color theme</p>
            </div>
            <ThemeToggle />
          </CardContent>
        </Card>

        <Card className="w-full">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle>Provider</CardTitle>
            <CardDescription>
              Choose a provider, paste your API key, and pick a default model. Credentials are
              saved on the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 py-4">
            <ProviderSetupForm
              submitLabel="Continue"
              showHeading={false}
              density="compact"
              onSuccess={goToChat}
            />
          </CardContent>
        </Card>

        <TelegramSettingsCard submitLabel="Save" />
      </div>
    </SetupLayout>
  );
}
