import type { CreateProviderResponse } from "@tinyclaw/core/contract";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { ModelsBrowseList } from "@/components/ModelsBrowseList";
import type { ModelsDevRow } from "@/hooks/use-models-dev";
import { Button } from "@/components/ui/button";
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
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import { OpenRouterProviderModelFields } from "@/components/OpenRouterProviderModelFields";
import { useProviderSetupForm } from "@/hooks/use-provider-setup-form";
import {
  apiKeyPlaceholder,
  type SelectedProvider,
  PROVIDER_OPTIONS,
} from "@/lib/models";

interface ProviderSetupFormProps {
  submitLabel?: string;
  showHeading?: boolean;
  density?: "default" | "compact";
  onSuccess?: (result: CreateProviderResponse) => void;
}

export function ProviderSetupForm({
  submitLabel = "Save & continue",
  showHeading = true,
  density = "default",
  onSuccess,
}: ProviderSetupFormProps) {
  const form = useProviderSetupForm({ onSuccess });
  const [isBrowsing, setIsBrowsing] = useState(false);

  const formSpacing = density === "compact" ? "space-y-4" : "space-y-5";

  function handleBrowseSelect(provider: SelectedProvider, modelId: string, row: ModelsDevRow) {
    form.handleBrowseSelect(provider, modelId, row);
    setIsBrowsing(false);
  }

  return (
    <form className={formSpacing} onSubmit={(event) => void form.handleSubmit(event)}>
      {showHeading && (
        <div>
          <h3 className="text-sm font-medium text-foreground">Connect a provider</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose a provider, paste your API key, and pick a default model.
          </p>
        </div>
      )}

      <FormField id="provider" label="Provider" density={density}>
        <Select
          value={isBrowsing ? "__browse__" : form.selectedProvider}
          disabled={form.busy}
          onValueChange={(v) => {
            if (v === "__browse__") {
              setIsBrowsing(true);
            } else if (isSelectedProvider(v)) {
              setIsBrowsing(false);
              form.handleProviderSelect(v);
            }
          }}
        >
          <SelectTrigger
            id="provider"
            className={density === "compact" ? "w-full" : "w-full sm:max-w-sm"}
          >
            <SelectValue>
              {isBrowsing
                ? "Browse models.dev…"
                : (PROVIDER_OPTIONS.find((o) => o.id === form.selectedProvider)?.label ??
                  form.selectedProvider)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_OPTIONS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
            <SelectItem value="__browse__">Browse models.dev…</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      {isBrowsing ? (
        <ModelsBrowseList
          onSelect={handleBrowseSelect}
          className="h-72 rounded-md border border-border"
        />
      ) : (
        <>
          {form.selectedProvider === "openai_compatible" ? (
            <CustomProviderFields
              displayName={form.displayName}
              baseUrl={form.baseUrl}
              apiKey={form.apiKey}
              customModels={form.customModels}
              disabled={form.busy}
              density={density}
              displayNameError={form.displayNameError}
              baseUrlError={form.baseUrlError}
              modelsError={form.modelsError}
              onDisplayNameChange={form.setDisplayName}
              onBaseUrlChange={form.setBaseUrl}
              onCustomModelsChange={form.setCustomModels}
            />
          ) : null}

          {form.selectedProvider === "openrouter" ? (
            <OpenRouterProviderModelFields
              customModels={form.openRouterModels}
              disabled={form.busy}
              density={density}
              modelsError={form.openRouterModelsError}
              onCustomModelsChange={form.handleOpenRouterModelsChange}
            />
          ) : null}

          <FormField
            id="api-key"
            label={form.selectedProvider === "openai_compatible" ? "API key (optional)" : "API key"}
            density={density}
            footer={
              form.apiKeyError ? (
                <p id="api-key-error" className="text-sm text-destructive" role="alert">
                  {form.apiKeyError}
                </p>
              ) : (
                <p id="api-key-hint" className="text-xs text-muted-foreground">
                  Paste the API key from your{" "}
                  {PROVIDER_OPTIONS.find((option) => option.id === form.selectedProvider)?.label ??
                    "provider"}{" "}
                  dashboard.
                </p>
              )
            }
          >
            <InputGroup>
              <InputGroupInput
                id="api-key"
                type={form.showApiKey ? "text" : "password"}
                autoComplete="off"
                placeholder={apiKeyPlaceholder(form.selectedProvider)}
                value={form.apiKey}
                disabled={form.busy}
                aria-invalid={form.apiKeyError != null}
                aria-describedby={form.apiKeyError ? "api-key-error" : "api-key-hint"}
                onBlur={form.handleApiKeyBlur}
                onChange={(event) => form.handleApiKeyChange(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  aria-label={form.showApiKey ? "Hide API key" : "Show API key"}
                  onClick={() => form.setShowApiKey((current) => !current)}
                >
                  {form.showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </FormField>

          {form.selectedProvider !== "openrouter" &&
          form.selectedProvider !== "openai_compatible" ? (
            <FormField id="model" label="Model" density={density}>
              <Select
                value={form.selectedModel}
                disabled={form.busy || form.filteredModels.length === 0}
                onValueChange={(value) => form.setSelectedModel(value != null ? String(value) : "")}
              >
                <SelectTrigger id="model" className="w-full">
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
            <p className="text-sm text-destructive" role="alert">
              {form.formError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="submit"
              disabled={
                form.busy ||
                (form.selectedProvider !== "openai_compatible" && !form.apiKey.trim())
              }
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

function isSelectedProvider(value: string | null): value is SelectedProvider {
  if (value == null) {
    return false;
  }

  return PROVIDER_OPTIONS.some((option) => option.id === value);
}
