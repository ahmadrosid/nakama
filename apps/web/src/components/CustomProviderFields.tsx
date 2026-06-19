import { useState } from "react";
import { ModelsBrowseList } from "@/components/ModelsBrowseList";
import { ModelListEditor, type ModelListRow } from "@/components/ModelListEditor";
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
  density?: "default" | "compact";
  showModelsEditor?: boolean;
  showThinkingToggle?: boolean;
  displayNameError?: string | null;
  baseUrlError?: string | null;
  modelsError?: string | null;
  onDisplayNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onCustomModelsChange: (models: ModelListRow[]) => void;
}

export function CustomProviderFields({
  displayName,
  baseUrl,
  customModels,
  disabled,
  density = "default",
  showModelsEditor = true,
  showThinkingToggle = false,
  displayNameError,
  baseUrlError,
  modelsError,
  onDisplayNameChange,
  onBaseUrlChange,
  onCustomModelsChange,
}: CustomProviderFieldsProps) {
  const [isBrowsing, setIsBrowsing] = useState(false);

  const handleBrowseSelect = (_provider: string, modelId: string, row: ModelsDevRow) => {
    const nextModel = { id: modelId, name: row.modelName };
    if (customModels.some((model) => model.id === nextModel.id)) {
      setIsBrowsing(false);
      return;
    }

    onCustomModelsChange([...customModels, nextModel]);
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
            disabled={disabled}
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
            disabled={disabled}
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
            ) : null
          }
        >
          {isBrowsing ? (
            <div className="space-y-2">
              <ModelsBrowseList
                onSelect={handleBrowseSelect}
                className="h-72 rounded-md border border-border"
              />
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => setIsBrowsing(false)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <>
              <ModelListEditor
                models={customModels}
                disabled={disabled}
                showThinkingToggle={showThinkingToggle}
                onBrowse={() => setIsBrowsing(true)}
                onChange={onCustomModelsChange}
              />
            </>
          )}
        </FormField>
      ) : null}
    </div>
  );
}
