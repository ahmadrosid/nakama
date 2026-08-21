import type { OllamaHostMode } from "@nakama/core/contract";
import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import type { ModelListRow } from "@/components/ModelListEditor";
import {
  type RemoteModelRow,
  RemoteModelsBrowseList,
} from "@/components/RemoteModelsBrowseList";

interface OllamaProviderModelFieldsProps {
  apiKey: string;
  baseUrl: string;
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  hostMode: OllamaHostMode;
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
}

export function OllamaProviderModelFields({
  apiKey,
  baseUrl,
  customModels,
  disabled,
  density = "default",
  hostMode,
  modelsError,
  onCustomModelsChange,
}: OllamaProviderModelFieldsProps) {
  return (
    <BrowsableModelFields
      browseLabel="Browse Ollama"
      customModels={customModels}
      density={density}
      disabled={disabled}
      fieldId="ollama-models"
      footerHint={
        <>
          Add models by ID or browse live models from your Ollama host (for
          example <span className="font-mono">llama3.2</span>).
        </>
      }
      modelsError={modelsError}
      onCustomModelsChange={onCustomModelsChange}
      renderBrowse={(onSelect) => (
        <RemoteModelsBrowseList
          apiKey={apiKey}
          baseUrl={baseUrl}
          browseLabel="Ollama"
          className="h-72 rounded-md border border-border"
          hostMode={hostMode}
          onSelect={onSelect}
          provider="ollama"
        />
      )}
      showPricing={false}
      showThinking
      showVision
      toModelRow={(row: RemoteModelRow) => ({
        id: row.id,
        name: row.name,
        ...(row.supportsVision === undefined
          ? {}
          : { supportsVision: row.supportsVision }),
      })}
    />
  );
}
