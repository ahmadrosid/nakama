import { useState } from "react";
import { ModelListEditor, type ModelListRow } from "@/components/ModelListEditor";
import { ModelsBrowseList } from "@/components/ModelsBrowseList";
import { RemoteModelsBrowseList } from "@/components/RemoteModelsBrowseList";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import type { ModelsDevRow } from "@/hooks/use-models-dev";

interface CustomProviderFieldsProps {
  displayName: string;
  baseUrl: string;
  apiKey: string;
  customModels: ModelListRow[];
  disabled?: boolean;
  identityReadOnly?: boolean;
  density?: "default" | "compact";
  showModelsEditor?: boolean;
  showThinkingToggle?: boolean;
  displayNameError?: string | null;
  baseUrlError?: string | null;
  modelsError?: string | null;
  /**
   * `remote` fetches models from the provider endpoint via /v1/models/discover.
   * `models.dev` browses the public models.dev catalog (setup helper for custom endpoints).
   */
  browseSource?: "remote" | "models.dev";
  remoteProvider?: "ollama" | "openai_compatible";
  providerInstanceId?: string;
  hostMode?: "local" | "cloud";
  browseLabel?: string;
  onDisplayNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onCustomModelsChange: (models: ModelListRow[]) => void;
}

export function CustomProviderFields({
  displayName,
  baseUrl,
  apiKey,
  customModels,
  disabled,
  identityReadOnly = false,
  density = "default",
  showModelsEditor = true,
  showThinkingToggle = false,
  displayNameError,
  baseUrlError,
  modelsError,
  browseSource = "remote",
  remoteProvider = "openai_compatible",
  providerInstanceId,
  hostMode,
  browseLabel,
  onDisplayNameChange,
  onBaseUrlChange,
  onCustomModelsChange,
}: CustomProviderFieldsProps) {
  const [isBrowsing, setIsBrowsing] = useState(false);
  const identityDisabled = disabled || identityReadOnly;
  const resolvedBrowseLabel =
    browseLabel ??
    (remoteProvider === "ollama" ? "Ollama" : "this endpoint");

  const handleModelsDevSelect = (_provider: string, modelId: string, row: ModelsDevRow) => {
    const nextModel = { id: modelId, name: row.modelName };
    if (customModels.some((model) => model.id === nextModel.id)) {
      setIsBrowsing(false);
      return;
    }

    onCustomModelsChange([...customModels, nextModel]);
    setIsBrowsing(false);
  };

  const handleRemoteSelect = (row: { id: string; name: string }) => {
    if (customModels.some((model) => model.id === row.id)) {
      setIsBrowsing(false);
      return;
    }

    onCustomModelsChange([...customModels, { id: row.id, name: row.name }]);
    setIsBrowsing(false);
  };

  return (
    <div className="space-y-4">
      <FormField
        id="provider-display-name"
        label="Provider name"
        density={density}
        footer={
          displayNameError ? (
            <p className="text-sm text-destructive" role="alert">
              {displayNameError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              How this endpoint appears in Settings and Status.
            </p>
          )
        }
      >
        <InputGroup>
          <InputGroupInput
            id="provider-display-name"
            value={displayName}
            disabled={identityDisabled}
            readOnly={identityReadOnly}
            placeholder="Ollama"
            aria-invalid={displayNameError != null}
            onChange={(event) => onDisplayNameChange(event.target.value)}
          />
        </InputGroup>
      </FormField>

      <FormField
        id="provider-base-url"
        label="Base URL"
        density={density}
        footer={
          baseUrlError ? (
            <p className="text-sm text-destructive" role="alert">
              {baseUrlError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              OpenAI-compatible root, e.g. http://localhost:11434/v1
            </p>
          )
        }
      >
        <InputGroup>
          <InputGroupInput
            id="provider-base-url"
            value={baseUrl}
            disabled={identityDisabled}
            readOnly={identityReadOnly}
            placeholder="http://localhost:11434/v1"
            aria-invalid={baseUrlError != null}
            onChange={(event) => onBaseUrlChange(event.target.value)}
          />
        </InputGroup>
      </FormField>

      {showModelsEditor ? (
        <FormField
          id="provider-models"
          label="Models"
          density={density}
          footer={
            modelsError ? (
              <p className="text-sm text-destructive" role="alert">
                {modelsError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {browseSource === "remote"
                  ? `Add models by ID or browse live models from ${resolvedBrowseLabel}.`
                  : "Add models by ID or browse models.dev."}
              </p>
            )
          }
        >
          {isBrowsing ? (
            <div className="space-y-2">
              {browseSource === "remote" ? (
                <RemoteModelsBrowseList
                  onSelect={handleRemoteSelect}
                  className="h-72 rounded-md border border-border"
                  providerId={providerInstanceId}
                  baseUrl={baseUrl}
                  apiKey={apiKey}
                  provider={remoteProvider}
                  hostMode={hostMode}
                  browseLabel={resolvedBrowseLabel}
                />
              ) : (
                <ModelsBrowseList
                  onSelect={handleModelsDevSelect}
                  className="h-72 rounded-md border border-border"
                />
              )}
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => setIsBrowsing(false)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <ModelListEditor
              models={customModels}
              disabled={disabled}
              showThinkingToggle={showThinkingToggle}
              browseLabel={
                browseSource === "remote"
                  ? `Browse ${resolvedBrowseLabel}`
                  : "Browse models.dev"
              }
              onBrowse={() => setIsBrowsing(true)}
              onChange={onCustomModelsChange}
            />
          )}
        </FormField>
      ) : null}
    </div>
  );
}
