import type { CreateProviderResponse } from "@nakama/core/contract";
import { ollamaRequiresApiKey } from "@nakama/core/ollama-provider-config";
import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import { useState } from "react";
import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import { ModelsBrowseList } from "@/components/ModelsBrowseList";
import { OllamaProviderSetupFields } from "@/components/OllamaProviderSetupFields";
import { OpenRouterProviderModelFields } from "@/components/OpenRouterProviderModelFields";
import { ProviderSelect } from "@/components/ProviderSelect";
import { RemoteModelsBrowseList } from "@/components/RemoteModelsBrowseList";
import { ShortlistBrowseProviderModelFields } from "@/components/ShortlistBrowseProviderModelFields";
import { isShortlistBrowseProvider } from "@/components/shortlist-browse-providers.shared";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { ModelsDevRow } from "@/hooks/use-models-dev";
import { useProviderSetupForm } from "@/hooks/use-provider-setup-form";
import {
  apiKeyPlaceholder,
  PROVIDER_OPTIONS,
  type SelectedProvider,
} from "@/lib/models";

interface ProviderSetupFormProps {
  density?: "default" | "compact";
  onSuccess?: (result: CreateProviderResponse) => void;
  showHeading?: boolean;
  submitLabel?: string;
}

export function ProviderSetupForm({
  submitLabel = "Save & continue",
  showHeading = true,
  density = "default",
  onSuccess,
}: ProviderSetupFormProps) {
  const form = useProviderSetupForm({ onSuccess });
  const [isBrowsing, setIsBrowsing] = useState(false);
  const ollamaKeyRequired = ollamaRequiresApiKey(form.ollamaHostMode);
  const apiKeyOptional =
    form.selectedProvider === "openai_compatible" ||
    (form.selectedProvider === "ollama" && !ollamaKeyRequired);
  const canPickModels = apiKeyOptional || form.apiKey.trim().length > 0;

  const formSpacing = density === "compact" ? "space-y-4" : "space-y-5";

  function handleBrowseSelect(
    provider: SelectedProvider,
    modelId: string,
    row: ModelsDevRow
  ) {
    form.handleBrowseSelect(provider, modelId, row);
    setIsBrowsing(false);
  }

  return (
    <form
      className={formSpacing}
      onSubmit={(event) => void form.handleSubmit(event)}
    >
      {showHeading && (
        <div>
          <h3 className="font-medium text-foreground text-sm">
            Connect a provider
          </h3>
          <p className="mt-1 text-muted-foreground text-xs">
            Choose a provider, paste your API key, and pick a default model.
          </p>
        </div>
      )}

      <FormField density={density} id="provider" label="Provider">
        <ProviderSelect
          configuredTypes={form.configuredTypes}
          disabled={form.busy}
          id="provider"
          onValueChange={(nextValue) => {
            if (nextValue === "__browse__") {
              setIsBrowsing(true);
              return;
            }

            setIsBrowsing(false);
            form.handleProviderSelect(nextValue);
          }}
          value={isBrowsing ? "__browse__" : form.selectedProvider}
        />
      </FormField>

      {isBrowsing ? (
        <ModelsBrowseList
          className="h-72 rounded-md border border-border"
          configuredTypes={form.configuredTypes}
          onSelect={handleBrowseSelect}
          openCodeZenConfigured={form.openCodeZenConfigured}
        />
      ) : (
        <>
          <FormField
            density={density}
            footer={
              form.apiKeyError ? (
                <p
                  className="text-destructive text-sm"
                  id="api-key-error"
                  role="alert"
                >
                  {form.apiKeyError}
                </p>
              ) : (
                <p className="text-muted-foreground text-xs" id="api-key-hint">
                  Paste the API key from your{" "}
                  {PROVIDER_OPTIONS.find(
                    (option) => option.id === form.selectedProvider
                  )?.label ?? "provider"}{" "}
                  dashboard.
                </p>
              )
            }
            id="api-key"
            label={apiKeyOptional ? "API key (optional)" : "API key"}
          >
            <InputGroup>
              <InputGroupInput
                aria-describedby={
                  form.apiKeyError ? "api-key-error" : "api-key-hint"
                }
                aria-invalid={form.apiKeyError != null}
                autoComplete="off"
                disabled={form.busy}
                id="api-key"
                onBlur={form.handleApiKeyBlur}
                onChange={(event) =>
                  form.handleApiKeyChange(event.target.value)
                }
                placeholder={apiKeyPlaceholder(form.selectedProvider)}
                type={form.showApiKey ? "text" : "password"}
                value={form.apiKey}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label={form.showApiKey ? "Hide API key" : "Show API key"}
                  onClick={() => form.setShowApiKey((current) => !current)}
                  size="icon-sm"
                >
                  {form.showApiKey ? <ViewOffIcon /> : <ViewIcon />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </FormField>

          {form.selectedProvider === "cloudflare" ? (
            <FormField
              density={density}
              footer={
                form.baseUrlError ? (
                  <p
                    className="text-destructive text-sm"
                    id="cloudflare-account-id-error"
                    role="alert"
                  >
                    {form.baseUrlError}
                  </p>
                ) : null
              }
              id="cloudflare-account-id"
              label="Account ID"
            >
              <Input
                aria-invalid={form.baseUrlError != null}
                autoComplete="off"
                disabled={form.busy}
                id="cloudflare-account-id"
                onChange={(event) => form.setBaseUrl(event.target.value)}
                value={form.baseUrl}
              />
            </FormField>
          ) : null}

          {form.selectedProvider === "openai_compatible" ? (
            <CustomProviderFields
              apiKey={form.apiKey}
              baseUrl={form.baseUrl}
              baseUrlError={form.baseUrlError}
              customModels={form.customModels}
              density={density}
              disabled={form.busy}
              displayName={form.displayName}
              displayNameError={form.displayNameError}
              modelsError={form.modelsError}
              onBaseUrlChange={form.setBaseUrl}
              onCustomModelsChange={form.setCustomModels}
              onDisplayNameChange={form.setDisplayName}
              showModelsEditor={canPickModels}
            />
          ) : null}

          {form.selectedProvider === "openrouter" && canPickModels ? (
            <OpenRouterProviderModelFields
              customModels={form.openRouterModels}
              density={density}
              disabled={form.busy}
              modelsError={form.openRouterModelsError}
              onCustomModelsChange={form.handleOpenRouterModelsChange}
            />
          ) : null}

          {form.selectedProvider === "ollama" ? (
            <>
              <OllamaProviderSetupFields
                baseUrl={form.baseUrl}
                baseUrlError={form.baseUrlError}
                density={density}
                disabled={form.busy}
                hostMode={form.ollamaHostMode}
                onBaseUrlChange={form.setBaseUrl}
                onHostModeChange={form.handleOllamaHostModeChange}
              />
              {canPickModels ? (
                <BrowsableModelFields
                  browseLabel="Browse Ollama"
                  customModels={form.customModels}
                  density={density}
                  disabled={form.busy}
                  fieldId="ollama-models"
                  footerHint={
                    <>
                      Add models by ID or browse live models from your Ollama
                      host (for example{" "}
                      <span className="font-mono">llama3.2</span>).
                    </>
                  }
                  modelsError={form.modelsError}
                  onCustomModelsChange={form.setCustomModels}
                  renderBrowse={(onSelect) => (
                    <RemoteModelsBrowseList
                      apiKey={form.apiKey}
                      baseUrl={form.baseUrl}
                      browseLabel="Ollama"
                      className="h-72 rounded-md border border-border"
                      hostMode={form.ollamaHostMode}
                      onSelect={onSelect}
                      provider="ollama"
                    />
                  )}
                  showPricing={false}
                  showThinking
                  showVision
                  toModelRow={(row: {
                    id: string;
                    name: string;
                    supportsVision?: boolean;
                  }) => ({
                    id: row.id,
                    name: row.name,
                    ...(row.supportsVision === undefined
                      ? {}
                      : { supportsVision: row.supportsVision }),
                  })}
                />
              ) : null}
            </>
          ) : null}

          {isShortlistBrowseProvider(form.selectedProvider) && canPickModels ? (
            <ShortlistBrowseProviderModelFields
              apiKey={
                form.selectedProvider === "fireworks" ? form.apiKey : undefined
              }
              customModels={form.shortlistModels}
              density={density}
              disabled={form.busy}
              modelsError={form.shortlistModelsError}
              onCustomModelsChange={form.handleShortlistModelsChange}
              provider={form.selectedProvider}
            />
          ) : null}

          {form.selectedProvider !== "openrouter" &&
          !isShortlistBrowseProvider(form.selectedProvider) &&
          form.selectedProvider !== "ollama" &&
          form.selectedProvider !== "openai_compatible" ? (
            <FormField density={density} id="model" label="Model">
              <Select
                disabled={form.busy || form.filteredModels.length === 0}
                onValueChange={(value) =>
                  form.setSelectedModel(value == null ? "" : String(value))
                }
                value={form.selectedModel}
              >
                <SelectTrigger className="w-full" id="model">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {form.filteredModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                      {model.default ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}

          {form.formError ? (
            <p className="text-destructive text-sm" role="alert">
              {form.formError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              disabled={form.busy || !(apiKeyOptional || form.apiKey.trim())}
              type="submit"
            >
              {form.busy ? (
                <>
                  <Spinner className="mr-2" />
                  Saving…
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
