import { defaultDiscoveryBaseUrl } from "@nakama/core/discovery-providers";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import type { useProviderSetupForm } from "@/hooks/use-provider-setup-form";
import { formatProviderLabel } from "@/lib/models";

/**
 * Netra, Groq and the other discovery providers have no catalog: Add lists
 * the account's models with the typed key, or takes an ID, as Manage does.
 * Setup shows this list too, because the server needs one model.
 */
export function DiscoveryProviderModelFields({
  canConnect,
  density,
  form,
}: {
  canConnect: boolean;
  density: "default" | "compact";
  form: ReturnType<typeof useProviderSetupForm>;
}) {
  const netra = form.selectedProvider === "netra";

  return (
    <CustomProviderFields
      apiKey={form.apiKey}
      baseUrl={defaultDiscoveryBaseUrl(form.selectedProvider) ?? ""}
      browseLabel={
        netra ? undefined : formatProviderLabel(form.selectedProvider)
      }
      customModels={form.customModels}
      density={density}
      disabled={form.busy}
      displayName={form.displayName}
      hideIdentity
      modelsError={form.modelsError}
      onBaseUrlChange={form.handleBaseUrlChange}
      onCustomModelsChange={form.handleCustomModelsChange}
      onDisplayNameChange={form.handleDisplayNameChange}
      remoteProvider={netra ? "netra" : undefined}
      showModelsEditor={canConnect}
    />
  );
}
