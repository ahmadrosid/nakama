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
import { Spinner } from "@/components/ui/spinner";
import { useProviderSetupForm } from "@/hooks/use-provider-setup-form";
import {
  apiKeyPlaceholder,
  type SelectedProvider,
  PROVIDER_OPTIONS,
} from "@/lib/models";
import { cn } from "@/lib/utils";

interface ProviderSetupFormProps {
  submitLabel?: string;
  showHeading?: boolean;
  onSuccess?: (result: ConfigureProviderResponse) => void;
}

export function ProviderSetupForm({
  submitLabel = "Save & continue",
  showHeading = true,
  onSuccess,
}: ProviderSetupFormProps) {
  const form = useProviderSetupForm({ onSuccess });

  return (
    <form className="space-y-5" onSubmit={(event) => void form.handleSubmit(event)}>
      {showHeading ? (
        <div>
          <h3 className="text-sm font-medium text-foreground">Connect a provider</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose a provider, paste your API key, and pick a default model.
          </p>
        </div>
      ) : null}

      <ProviderOptionCards
        selectedProvider={form.selectedProvider}
        disabled={form.busy}
        onSelect={form.handleProviderSelect}
      />

      <div className="space-y-3">
        <label htmlFor="api-key" className="block text-sm font-medium text-foreground">
          API key
        </label>
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
        {form.apiKeyError ? (
          <p id="api-key-error" className="text-sm text-destructive" role="alert">
            {form.apiKeyError}
          </p>
        ) : (
          <p id="api-key-hint" className="text-xs text-muted-foreground">
            Paste the API key from your {PROVIDER_OPTIONS.find((option) => option.id === form.selectedProvider)?.label ?? "provider"} dashboard.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <label htmlFor="model" className="block text-sm font-medium text-foreground">
          Model
        </label>
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
      </div>

      {form.selectedProvider === "openrouter" ? (
        <div className="space-y-2">
          <label htmlFor="custom-model" className="text-sm font-medium text-foreground">
            Custom model ID <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
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
          {form.customModelError ? (
            <p id="custom-model-error" className="text-sm text-destructive" role="alert">
              {form.customModelError}
            </p>
          ) : (
            <p id="custom-model-hint" className="text-xs text-muted-foreground">
              Overrides the catalog selection when set. Use vendor/model format from OpenRouter.
            </p>
          )}
        </div>
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

export function ProviderOptionCards({
  selectedProvider,
  disabled,
  onSelect,
}: {
  selectedProvider: SelectedProvider;
  disabled?: boolean;
  onSelect: (provider: SelectedProvider) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">Provider</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PROVIDER_OPTIONS.map((option) => {
          const active = selectedProvider === option.id;
          const subtitle =
            option.id === "openai"
              ? "GPT models"
              : option.id === "anthropic"
                ? "Claude models"
                : "Many models via one key";

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(option.id)}
              className={cn(
                "rounded-lg border p-4 text-left transition-colors",
                active
                  ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                  : "border-border bg-background hover:bg-muted/50",
              )}
            >
              <p className="text-sm font-medium text-foreground">{option.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
