import { Button } from "@nakama/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@nakama/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { toast } from "@nakama/ui/toast";
import { Add01Icon, Alert02Icon } from "hugeicons-react";
import { ProviderSetupForm } from "@/components/ProviderSetupForm";
import {
  useDeleteProviderMutation,
  useModelsQuery,
  useProvidersQuery,
  useUpdateProviderMutation,
} from "@/hooks/use-app-queries";
import { client, formatError } from "@/lib/client";
import { ProviderInstanceCard } from "./provider-instance-card";

interface ProviderSettingsCardProps {
  addOpen: boolean;
  formError: string | null;
  onAddOpenChange: (open: boolean) => void;
  onFormError: (error: string | null) => void;
}

export function ProviderSettingsCard({
  addOpen,
  formError,
  onAddOpenChange: setAddOpen,
  onFormError,
}: ProviderSettingsCardProps) {
  const {
    data: providersResponse,
    isLoading: providersLoading,
    refetch: refetchProviders,
  } = useProvidersQuery();

  const {
    data: catalogResponse,
    isLoading: catalogLoading,
    error: catalogQueryError,
    refetch: refetchModels,
  } = useModelsQuery({
    enabled: (providersResponse?.providers.length ?? 0) > 0,
  });

  const updateProviderMutation = useUpdateProviderMutation();
  const deleteProviderMutation = useDeleteProviderMutation();

  const providers = providersResponse?.providers ?? [];
  const catalog = catalogResponse?.models ?? [];
  const isConfigured = providers.length > 0;

  const catalogError = catalogQueryError
    ? formatError(catalogQueryError)
    : null;

  const displayError = formError ?? catalogError;

  if (providersLoading || catalogLoading) {
    return <ProviderSettingsSkeleton />;
  }

  return (
    <>
      <Card className="w-full shadow-none">
        <CardHeader className="border-border border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="min-w-0 font-medium text-sm leading-snug tracking-normal">
              Connected providers
            </CardTitle>
            {isConfigured ? (
              <Button
                onClick={() => setAddOpen(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Add01Icon className="mr-1.5 size-4" />
                Add provider
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isConfigured ? (
            <ul className="divide-y divide-border">
              {providers.map((instance) => (
                <ProviderInstanceCard
                  catalog={catalog}
                  instance={instance}
                  isDefault={
                    providersResponse?.defaultProviderId === instance.id
                  }
                  isSole={providers.length === 1}
                  key={instance.id}
                  onDelete={async (providerId) => {
                    await deleteProviderMutation.mutateAsync(providerId);
                    toast("Provider removed.");
                    onFormError(null);
                  }}
                  onError={onFormError}
                  onManage={async (providerId, action) => {
                    await client.manageProviderSecret(providerId, action);
                    await Promise.all([refetchProviders(), refetchModels()]);
                    onFormError(null);
                  }}
                  onUpdate={async (providerId, request) => {
                    await updateProviderMutation.mutateAsync({
                      providerId,
                      request,
                    });
                    toast("Provider updated.");
                    onFormError(null);
                  }}
                />
              ))}
            </ul>
          ) : (
            <>
              <div className="flex items-start gap-3 border-border border-b px-4 py-3">
                <Alert02Icon
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-amber-200"
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium text-amber-100 text-sm">
                    No provider connected
                  </p>
                  <p className="text-amber-200/90 text-xs">
                    Chat is offline until you add a provider below.
                  </p>
                </div>
              </div>
              <div className="px-4 py-4">
                <ProviderSetupForm
                  onSuccess={() => {
                    toast("Provider added.");
                    onFormError(null);
                  }}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {displayError ? (
        <p className="text-destructive text-sm" role="alert">
          {displayError}
        </p>
      ) : null}

      {/* A click outside must not throw away a typed key or picked models. */}
      <Dialog disablePointerDismissal onOpenChange={setAddOpen} open={addOpen}>
        <DialogContent className="w-[min(96vw,56rem)] scroll-pb-24 grid-cols-[minmax(0,1fr)] sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Add provider</DialogTitle>
          </DialogHeader>
          <ProviderSetupForm
            onCancel={() => setAddOpen(false)}
            onSuccess={() => {
              setAddOpen(false);
              toast("Provider added.");
              onFormError(null);
            }}
            showHeading={false}
            submitLabel="Add provider"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProviderSettingsSkeleton() {
  return (
    <Card aria-hidden="true" className="w-full animate-pulse shadow-none">
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
