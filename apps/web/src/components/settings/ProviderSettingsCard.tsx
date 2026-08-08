import { AlertTriangleIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { ProviderSetupForm } from "@/components/ProviderSetupForm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { toast } from "@/lib/toast";
import { ProviderInstanceCard } from "./provider-instance-card";

interface ProviderSettingsCardProps {
  formError: string | null;
  onFormError: (error: string | null) => void;
}

export function ProviderSettingsCard({
  formError,
  onFormError,
}: ProviderSettingsCardProps) {
  const { data: providersResponse, isLoading: providersLoading } =
    useProvidersQuery();
  const {
    data: catalogResponse,
    isLoading: catalogLoading,
    error: catalogQueryError,
  } = useModelsQuery({
    enabled: (providersResponse?.providers.length ?? 0) > 0,
  });
  const updateProviderMutation = useUpdateProviderMutation();
  const deleteProviderMutation = useDeleteProviderMutation();
  const [addOpen, setAddOpen] = useState(false);

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
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <CardTitle className="font-medium text-sm leading-snug tracking-normal">
                LLM providers
              </CardTitle>
              <CardDescription className="text-xs leading-snug">
                Connect providers and choose models for chat.
              </CardDescription>
            </div>
            {isConfigured ? (
              <Button
                onClick={() => setAddOpen(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                <PlusIcon className="mr-1.5 size-4" />
                Add provider
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isConfigured ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="border-border border-b bg-muted/30 text-muted-foreground text-xs">
                  <tr>
                    <th className="px-3 py-2 font-medium">Provider</th>
                    <th className="px-3 py-2 font-medium">Endpoint</th>
                    <th className="px-3 py-2 font-medium">Models</th>
                    <th className="px-3 py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {providers.map((instance) => (
                    <ProviderInstanceCard
                      catalog={catalog}
                      instance={instance}
                      key={instance.id}
                      onDelete={async (providerId) => {
                        await deleteProviderMutation.mutateAsync(providerId);
                        toast("Provider removed.");
                        onFormError(null);
                      }}
                      onError={onFormError}
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
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3 border-border border-b px-4 py-3">
                <AlertTriangleIcon
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

      <Dialog onOpenChange={setAddOpen} open={addOpen}>
        <DialogContent className="w-[min(96vw,56rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add provider</DialogTitle>
          </DialogHeader>
          <ProviderSetupForm
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
