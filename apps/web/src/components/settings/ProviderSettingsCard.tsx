import { useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";
import { ProviderSetupForm } from "@/components/ProviderSetupForm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppContext } from "@/context/app-context";
import { useModelsQuery } from "@/hooks/use-app-queries";
import { useOpenRouterModels } from "@/hooks/use-openrouter-models";
import { formatError } from "@/lib/client";
import {
  filterModelsByProvider,
  formatProviderLabel,
  type SelectedProvider,
} from "@/lib/models";
import {
  mergeOpenRouterModelOptions,
  openRouterModelDisplayName,
} from "@/lib/openrouter-models";
import { ConnectedProviderSection } from "./connected-provider-section";
import { SwitchProviderSection } from "./switch-provider-section";

interface ProviderSettingsCardProps {
  formError: string | null;
  onFormError: (error: string | null) => void;
}

export function ProviderSettingsCard({ formError, onFormError }: ProviderSettingsCardProps) {
  const { health, models, configureProvider } = useAppContext();
  const { data: catalogResponse, isLoading: catalogLoading, error: catalogQueryError } =
    useModelsQuery();
  const { data: openRouterRows = [] } = useOpenRouterModels();
  const catalog = catalogResponse?.models ?? [];

  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isConfigured = health?.providerConfigured === true && models != null;

  useEffect(() => {
    if (catalogQueryError) {
      onFormError(formatError(catalogQueryError));
    }
  }, [catalogQueryError, onFormError]);

  const configuredModels = useMemo(() => {
    const filtered = filterModelsByProvider(catalog, models?.provider);
    if (models?.provider === "openrouter" && models.currentModel) {
      return mergeOpenRouterModelOptions(
        filtered,
        models.currentModel,
        openRouterModelDisplayName(openRouterRows, models.currentModel),
      );
    }
    return filtered;
  }, [catalog, models?.provider, models?.currentModel, openRouterRows]);

  if (catalogLoading) {
    return <ProviderSettingsSkeleton />;
  }

  return (
    <>
      <Card className="w-full">
        <CardContent className="p-0">
          {!isConfigured ? (
            <>
              <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                <AlertTriangleIcon
                  className="mt-0.5 size-5 shrink-0 text-amber-200"
                  aria-hidden="true"
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-amber-100">No provider connected</p>
                  <p className="text-xs text-amber-200/90">
                    Chat is offline until you add an API key below.
                  </p>
                </div>
              </div>
              <div className="px-4 py-4">
                <ProviderSetupForm
                  onSuccess={() => {
                    setSuccessMessage("Provider connected.");
                  }}
                />
              </div>
            </>
          ) : (
            <ConnectedProviderSection
              models={models}
              configureProvider={configureProvider}
              configuredModels={configuredModels}
              formError={formError}
              onFormError={onFormError}
              onReplaceKeyOpen={() => setSuccessMessage(null)}
              onReplaceKeySuccess={() => setSuccessMessage("API key updated.")}
            />
          )}
        </CardContent>
      </Card>

      {successMessage ? (
        <div className="flex items-start gap-3" role="status" aria-live="polite">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-300" />
          <p className="text-sm text-emerald-100">{successMessage}</p>
        </div>
      ) : null}

      {isConfigured && models?.provider ? (
        <Card className="w-full">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle>Switch provider</CardTitle>
            <CardDescription>
              Currently on {formatProviderLabel(models.provider, models.displayName)}. Chat
              history resets when you change providers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <SwitchProviderSection
              currentProvider={models.provider as SelectedProvider}
              catalog={catalog}
              configureProvider={configureProvider}
              onSuccess={(message) => {
                setSuccessMessage(message);
                onFormError(null);
              }}
            />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function ProviderSettingsSkeleton() {
  return (
    <Card className="w-full animate-pulse" aria-hidden="true">
      <CardContent className="space-y-5 p-4">
        <div className="space-y-2">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-4 w-48 rounded bg-muted" />
        </div>
        <div className="h-10 max-w-sm rounded-lg bg-muted" />
        <div className="border-t border-border pt-4">
          <div className="h-10 rounded-lg bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}
