import type { ConfigureProviderResponse } from "@tinyclaw/core/contract";
import { EyeIcon, EyeOffIcon } from "lucide-react";
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
  onSuccess?: (result: ConfigureProviderResponse) => void;
}

export function ProviderSetupForm({
  submitLabel = "Save & continue",
  showHeading = true,
  density = "default",
  onSuccess,
}: ProviderSetupFormProps) {
  const form = useProviderSetupForm({ onSuccess });

  const formSpacing = density === "compact" ? "space-y-4" : "space-y-5";

  return (
    <form className={formSpacing} onSubmit={(event) => void form.handleSubmit(event)}>
      {showHeading ? (
        <div>
          <h3 className="text-sm font-medium text-foreground">Connect a provider</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose a provider, paste your API key, and pick a default model.
          </p>
        </div>
      ) : null}

      <ProviderSelect
        selectedProvider={form.selectedProvider}
        disabled={form.busy}
        density={density}
        onSelect={form.handleProviderSelect}
      />

      <FormField
        id="api-key"
        label="API key"
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

      {form.selectedProvider === "openrouter" ? (
        <FormField
          id="custom-model"
          density={density}
          label={
            <>
              Custom model ID <span className="font-normal text-muted-foreground">(optional)</span>
            </>
          }
          footer={
            form.customModelError ? (
              <p id="custom-model-error" className="text-sm text-destructive" role="alert">
                {form.customModelError}
              </p>
            ) : (
              <p id="custom-model-hint" className="text-xs text-muted-foreground">
                Overrides the catalog selection when set. Use vendor/model format from OpenRouter.
              </p>
            )
          }
        >
          <InputGroup>
            <InputGroupInput
              id="custom-model"
              type="text"
              autoComplete="off"
              placeholder="anthropic/claude-sonnet-4-6"
              value={form.customModel}
              disabled={form.busy}
              aria-invalid={form.customModelError != null}
              aria-describedby={
                form.customModelError ? "custom-model-error" : "custom-model-hint"
              }
              onChange={(event) => form.handleCustomModelChange(event.target.value)}
            />
          </InputGroup>
        </FormField>
      ) : null}

      {form.formError ? (
        <p className="text-sm text-destructive" role="alert">
          {form.formError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={form.busy || !form.apiKey.trim()}>
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
    </form>
  );
}

function isSelectedProvider(value: string | null): value is SelectedProvider {
  if (value == null) {
    return false;
  }

  return PROVIDER_OPTIONS.some((option) => option.id === value);
}

export function ProviderSelect({
  id = "provider",
  label = "Provider",
  selectedProvider,
  disabled,
  excludeProvider,
  density = "default",
  onSelect,
}: {
  id?: string;
  label?: string;
  selectedProvider: SelectedProvider;
  disabled?: boolean;
  density?: "default" | "compact";
  /** Hide one provider (e.g. the active one when switching). */
  excludeProvider?: SelectedProvider;
  onSelect: (provider: SelectedProvider) => void;
}) {
  const options = excludeProvider
    ? PROVIDER_OPTIONS.filter((option) => option.id !== excludeProvider)
    : PROVIDER_OPTIONS;

  return (
    <FormField id={id} label={label} density={density}>
      <Select
        value={selectedProvider}
        disabled={disabled}
        onValueChange={(value) => {
          if (value != null && isSelectedProvider(value)) {
            onSelect(value);
          }
        }}
      >
        <SelectTrigger
          id={id}
          className={density === "compact" ? "w-full" : "w-full sm:max-w-sm"}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}
