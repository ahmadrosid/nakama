import { Add01Icon } from "hugeicons-react";
import { useState } from "react";
import {
  ModelListEditor,
  type ModelListRow,
} from "@/components/ModelListEditor";
import { ModelsBrowseList } from "@/components/ModelsBrowseList";
import { RemoteModelsBrowseList } from "@/components/RemoteModelsBrowseList";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import type { ModelsDevRow } from "@/hooks/use-models-dev";

interface CustomProviderFieldsProps {
  apiKey: string;
  baseUrl: string;
  baseUrlError?: string | null;
  browseLabel?: string;
  /**
   * `remote` fetches models from the provider endpoint via /v1/models/discover.
   * `models.dev` browses the public models.dev catalog (setup helper for custom endpoints).
   */
  browseSource?: "remote" | "models.dev";
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  displayName: string;
  displayNameError?: string | null;
  hostMode?: "local" | "cloud";
  identityReadOnly?: boolean;
  modelsError?: string | null;
  onBaseUrlChange: (value: string) => void;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  onDisplayNameChange: (value: string) => void;
  providerInstanceId?: string;
  remoteProvider?: "ollama" | "openai_compatible";
  showModelsEditor?: boolean;
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
  const [isBrowsing, setIsBrowsing] = useState(customModels.length === 0);
  const showBrowse = isBrowsing || customModels.length === 0;
  const identityDisabled = disabled || identityReadOnly;
  const resolvedBrowseLabel =
    browseLabel ?? (remoteProvider === "ollama" ? "Ollama" : "this endpoint");

  const handleModelsDevSelect = (
    _provider: string,
    modelId: string,
    row: ModelsDevRow
  ) => {
    const nextModel = {
      id: modelId,
      name: row.modelName,
      supportsVision: row.vision,
    };
    if (customModels.some((model) => model.id === nextModel.id)) {
      setIsBrowsing(false);
      return;
    }

    onCustomModelsChange([...customModels, nextModel]);
    setIsBrowsing(false);
  };

  const handleRemoteSelect = (row: {
    id: string;
    name: string;
    supportsVision?: boolean;
  }) => {
    if (customModels.some((model) => model.id === row.id)) {
      setIsBrowsing(false);
      return;
    }

    onCustomModelsChange([
      ...customModels,
      {
        id: row.id,
        name: row.name,
        ...(row.supportsVision === undefined
          ? {}
          : { supportsVision: row.supportsVision }),
      },
    ]);
    setIsBrowsing(false);
  };

  return (
    <div className="space-y-4">
      <FormField
        density={density}
        footer={
          displayNameError ? (
            <p className="text-destructive text-sm" role="alert">
              {displayNameError}
            </p>
          ) : null
        }
        id="provider-display-name"
        label="Provider name"
      >
        <InputGroup>
          <InputGroupInput
            aria-invalid={displayNameError != null}
            disabled={identityDisabled}
            id="provider-display-name"
            onChange={(event) => onDisplayNameChange(event.target.value)}
            placeholder="Ollama"
            readOnly={identityReadOnly}
            value={displayName}
          />
        </InputGroup>
      </FormField>

      <FormField
        density={density}
        footer={
          baseUrlError ? (
            <p className="text-destructive text-sm" role="alert">
              {baseUrlError}
            </p>
          ) : null
        }
        id="provider-base-url"
        label="Base URL"
      >
        <InputGroup>
          <InputGroupInput
            aria-invalid={baseUrlError != null}
            disabled={identityDisabled}
            id="provider-base-url"
            onChange={(event) => onBaseUrlChange(event.target.value)}
            placeholder="http://localhost:11434/v1"
            readOnly={identityReadOnly}
            value={baseUrl}
          />
        </InputGroup>
      </FormField>

      {showModelsEditor ? (
        <FormField
          density={density}
          footer={
            modelsError ? (
              <p className="text-destructive text-sm" role="alert">
                {modelsError}
              </p>
            ) : null
          }
          id="provider-models"
          label="Models"
        >
          {showBrowse ? (
            <div className="space-y-2">
              {browseSource === "remote" ? (
                <RemoteModelsBrowseList
                  apiKey={apiKey}
                  baseUrl={baseUrl}
                  browseLabel={resolvedBrowseLabel}
                  className="h-72 rounded-md border border-border"
                  hostMode={hostMode}
                  onSelect={handleRemoteSelect}
                  provider={remoteProvider}
                  providerId={providerInstanceId}
                />
              ) : (
                <ModelsBrowseList
                  className="h-72 rounded-md border border-border"
                  onSelect={handleModelsDevSelect}
                />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  disabled={disabled}
                  onClick={() => {
                    onCustomModelsChange([
                      ...customModels,
                      { id: "", name: "" },
                    ]);
                    setIsBrowsing(false);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Add01Icon className="mr-1 size-4" />
                  Add model
                </Button>
                {customModels.length > 0 ? (
                  <Button
                    onClick={() => setIsBrowsing(false)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Back
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <ModelListEditor
              browseLabel={
                browseSource === "remote"
                  ? `Browse ${resolvedBrowseLabel}`
                  : "Browse models.dev"
              }
              disabled={disabled}
              models={customModels}
              onBrowse={() => setIsBrowsing(true)}
              onChange={onCustomModelsChange}
              showPricing={false}
              showThinking
              showVision
            />
          )}
        </FormField>
      ) : null}
    </div>
  );
}
