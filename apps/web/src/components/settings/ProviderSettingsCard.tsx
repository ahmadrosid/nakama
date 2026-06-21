import { useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, PlusIcon } from "lucide-react";
import { ProviderSetupForm } from "@/components/ProviderSetupForm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useDeleteProviderMutation,
  useModelsQuery,
  useProvidersQuery,
  useUpdateProviderMutation,
} from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import { ProviderInstanceCard } from "./provider-instance-card";

interface ProviderSettingsCardProps {
  formError: string | null;
  onFormError: (error: string | null) => void;
}

export function ProviderSettingsCard({ formError, onFormError }: ProviderSettingsCardProps) {
  const { data: providersResponse, isLoading: providersLoading } = useProvidersQuery();
  const { data: catalogResponse, isLoading: catalogLoading, error: catalogQueryError } =
    useModelsQuery({ enabled: (providersResponse?.providers.length ?? 0) > 0 });
  const updateProviderMutation = useUpdateProviderMutation();
  const deleteProviderMutation = useDeleteProviderMutation();
  const [addOpen, setAddOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const providers = providersResponse?.providers ?? [];
  const catalog = catalogResponse?.models ?? [];
  const isConfigured = providers.length > 0;

  if (catalogQueryError) {
    onFormError(formatError(catalogQueryError));
  }

  if (providersLoading || catalogLoading) {
    return <ProviderSettingsSkeleton />;
  }

  return (
    <>
      <Card className="w-full shadow-none">
        <CardHeader className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>LLM providers</CardTitle>
              <CardDescription>
                Add providers and manage models. Pick any configured model in chat.
              </CardDescription>
            </div>
            {isConfigured ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <PlusIcon className="mr-1.5 size-4" />
                Add provider
              </Button>
            ) : null}
          </div>
        </CardHeader>
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
                    Chat is offline until you add a provider below.
                  </p>
                </div>
              </div>
              <div className="px-4 py-4">
                <ProviderSetupForm
                  onSuccess={() => {
                    setSuccessMessage("Provider added.");
                    onFormError(null);
                  }}
                />
              </div>
            </>
          ) : (
            providers.map((instance) => (
              <ProviderInstanceCard
                key={instance.id}
                instance={instance}
                catalog={catalog}
                onUpdate={async (providerId, request) => {
                  await updateProviderMutation.mutateAsync({ providerId, request });
                  setSuccessMessage("Provider updated.");
                  onFormError(null);
                }}
                onDelete={async (providerId) => {
                  await deleteProviderMutation.mutateAsync(providerId);
                  setSuccessMessage("Provider removed.");
                  onFormError(null);
                }}
                onError={onFormError}
              />
            ))
          )}
        </CardContent>
      </Card>

      {formError ? (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      ) : null}

      {successMessage ? (
        <div className="flex items-start gap-3" role="status" aria-live="polite">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-300" />
          <p className="text-sm text-emerald-100">{successMessage}</p>
        </div>
      ) : null}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add provider</DialogTitle>
          </DialogHeader>
          <ProviderSetupForm
            showHeading={false}
            submitLabel="Add provider"
            onSuccess={() => {
              setAddOpen(false);
              setSuccessMessage("Provider added.");
              onFormError(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProviderSettingsSkeleton() {
  return (
    <Card className="w-full animate-pulse shadow-none" aria-hidden="true">
      <CardContent className="space-y-5 p-4">
        <div className="space-y-2">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-4 w-48 rounded bg-muted" />
        </div>
        <div className="h-10 max-w-sm rounded-lg bg-muted" />
      </CardContent>
    </Card>
  );
}
